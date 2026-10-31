/**
 * Session cookies (SECURITY.md section 5). Every auth token lives in an
 * HttpOnly cookie, so page scripts never see it and it never appears in a
 * response body.
 *
 * - access:   short-lived Supabase access token, sent to every /api call.
 * - refresh:  long-lived refresh token, only sent to /api/auth.
 * - csrf:     random value checked against the X-CSRF-Token header.
 * - recovery: password-reset token from an email link, only sent to /api/auth, 15 minutes.
 *
 * In production (Secure cookies) access and csrf use the __Host- prefix, which
 * forces Secure, Path=/ and no Domain, so a subdomain can't plant or overwrite them.
 */
import type { CookieOptions, Request, Response } from "express";
import type { Session } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env.js";
import { isCsrfToken, newCsrfToken } from "../middleware/security.js";

const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_MAX_AGE_MS = 15 * 60 * 1000;
const CSRF_MAX_AGE_MS = REFRESH_MAX_AGE_MS;

export type CookieNames = { access: string; refresh: string; csrf: string; recovery: string };

export function cookieNames(secure: boolean): CookieNames {
  const host = secure ? "__Host-" : "";
  return { access: `${host}rr_access`, refresh: "rr_refresh", csrf: `${host}rr_csrf`, recovery: "rr_recovery" };
}

export function sessionCookies(config: AppConfig) {
  const names = cookieNames(config.cookies.secure);
  const base: CookieOptions = { httpOnly: true, secure: config.cookies.secure, sameSite: config.cookies.sameSite };
  const rootPath: CookieOptions = { ...base, path: "/" };
  const authPath: CookieOptions = { ...base, path: "/api/auth" };

  return {
    names,

    /** Sets the access and refresh cookies from a fresh Supabase session. */
    set(res: Response, session: Session) {
      const accessMs = Math.max(60, session.expires_in ?? 3600) * 1000;
      res.cookie(names.access, session.access_token, { ...rootPath, maxAge: accessMs });
      res.cookie(names.refresh, session.refresh_token, { ...authPath, maxAge: REFRESH_MAX_AGE_MS });
    },

    /** Removes every session cookie (logout, expiry, account deletion). */
    clear(res: Response) {
      res.clearCookie(names.access, rootPath);
      res.clearCookie(names.refresh, authPath);
      res.clearCookie(names.recovery, authPath);
    },

    accessToken: (req: Request): string | null => {
      const v: unknown = req.cookies?.[names.access];
      return typeof v === "string" && v ? v : null;
    },
    refreshToken: (req: Request): string | null => {
      const v: unknown = req.cookies?.[names.refresh];
      return typeof v === "string" && v ? v : null;
    },

    setRecovery(res: Response, accessToken: string) {
      res.cookie(names.recovery, accessToken, { ...authPath, maxAge: RECOVERY_MAX_AGE_MS });
    },
    recoveryToken: (req: Request): string | null => {
      const v: unknown = req.cookies?.[names.recovery];
      return typeof v === "string" && v ? v : null;
    },
    clearRecovery(res: Response) {
      res.clearCookie(names.recovery, authPath);
    },

    /** Returns the current CSRF token, issuing a new one when missing. */
    csrf(req: Request, res: Response): string {
      const existing: unknown = req.cookies?.[names.csrf];
      if (isCsrfToken(existing)) return existing;
      const token = newCsrfToken();
      res.cookie(names.csrf, token, { ...rootPath, maxAge: CSRF_MAX_AGE_MS });
      return token;
    },
    /** A new CSRF token after sign-in or sign-out, so an old one can't be reused. */
    rotateCsrf(res: Response): string {
      const token = newCsrfToken();
      res.cookie(names.csrf, token, { ...rootPath, maxAge: CSRF_MAX_AGE_MS });
      return token;
    },
  };
}

export type SessionCookies = ReturnType<typeof sessionCookies>;
