import type { RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "./errors.js";

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
    }
  }
}

/** Rejects the request unless it carries a valid Supabase access token. */
export function requireAuth(supabase: SupabaseClients): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) {
      return next(new HttpError(401, "unauthorised", "Please sign in."));
    }

    const accessToken = match[1].trim();
    const { data, error } = await supabase.auth().auth.getUser(accessToken);
    if (error || !data.user) {
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
