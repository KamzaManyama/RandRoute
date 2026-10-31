import type { RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClients } from "../lib/supabase.js";
import type { SessionCookies } from "../lib/sessionCookies.js";
import { HttpError } from "./errors.js";
import { securityLog } from "./security.js";

export type AuthContext = {
  userId: string;
  email: string | undefined;
  accessToken: string;
  /** Supabase client acting as this user (RLS enforced). */
  db: SupabaseClient;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Access token from the HttpOnly session cookie, if any. */
      sessionToken?: string | null;
    }
  }
}

/**
 * Reads the access token from the HttpOnly cookie. Bearer headers are not
 * accepted: the browser never holds a readable token (SECURITY.md 5.2).
 */
export function readSessionCookie(cookies: SessionCookies): RequestHandler {
  return (req, _res, next) => {
    req.sessionToken = cookies.accessToken(req);
    next();
  };
}

/**
 * Rejects the request unless it carries a valid, unexpired, unrevoked
 * Supabase session. The user ID always comes from the verified token, never
 * from the request.
 */
export function requireAuth(supabase: SupabaseClients): RequestHandler {
  return async (req, _res, next) => {
    const accessToken = req.sessionToken;
    if (!accessToken) {
      return next(new HttpError(401, "unauthorised", "Please sign in."));
    }

    // getUser checks the token with Supabase, so revoked sessions are rejected too.
    const { data, error } = await supabase.auth().auth.getUser(accessToken);
    if (error || !data.user) {
      securityLog("auth_failed", req);
      return next(new HttpError(401, "unauthorised", "Your session has expired. Please sign in again."));
    }

    req.auth = {
      userId: data.user.id,
      email: data.user.email,
      accessToken,
      db: supabase.forUser(accessToken),
    };
    next();
  };
}
