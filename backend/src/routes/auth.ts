import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { getBearerToken, requireAuth } from "../middleware/requireAuth.js";

export const REFRESH_COOKIE = "rr_refresh";
/** Custom header every auth call must send. Browsers can't add it cross-site without a CORS preflight. */
export const CLIENT_HEADER = "x-randroute-client";
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A password-reset token must come from an email link opened within this window. */
const RESET_LINK_MAX_AGE_S = 60 * 60;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const email = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, { error: "Enter your email address.", abort: true })
  .max(254, "Email address is too long.")
  .pipe(z.email({ error: "Enter a valid email address." }));

const newPassword = z
  .string({ error: "Enter a password." })
  .min(8, "Use at least 8 characters.")
  .max(72, "Use 72 characters or fewer.")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "Include at least one letter and one number.");

const registerSchema = z.object({
  email,
  password: newPassword,
  displayName: z
    .string()
    .trim()
    .max(60, "Use 60 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
const loginSchema = z.object({
  email,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(200),
});
const emailOnlySchema = z.object({ email });
const resetSchema = z.object({ password: newPassword });
const sessionSchema = z.object({ refreshToken: z.string().min(10).max(4000) });

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type PublicUser = { id: string; email: string | null; displayName: string | null };
type SessionResponse = { accessToken: string; expiresAt: number; user: PublicUser };

function publicUser(user: User): PublicUser {
  const name = user.user_metadata?.display_name;
  return { id: user.id, email: user.email ?? null, displayName: typeof name === "string" && name ? name : null };
}

function toSessionResponse(session: Session): SessionResponse {
  return {
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    user: publicUser(session.user),
  };
}

function isRateLimited(error: AuthError): boolean {
  return error.status === 429 || (error.code ?? "").startsWith("over_");
}

const tooManyAttempts = () =>
  new HttpError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");

const authUnavailable = () =>
  new HttpError(502, "auth_unavailable", "We couldn't reach the sign-in service. Please try again shortly.");

/** Reads the `amr` (how the user authenticated) claim from an already-verified JWT. */
function authMethods(accessToken: string): { method: string; timestamp: number }[] {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    return Array.isArray(payload.amr) ? payload.amr : [];
  } catch {
    return [];
  }
}

const VERIFY_EMAIL_RESPONSE = {
  status: "verification_required",
  message:
    "Check your inbox for a link to verify your email address. If you already have an account, sign in instead.",
} as const;

const RESET_EMAIL_RESPONSE = {
  message: "If an account exists for that email, we've sent a link to reset your password.",
} as const;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function authRouter({ config, supabase }: { config: AppConfig; supabase: SupabaseClients }): Router {
  const router = Router();

  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    path: "/api/auth",
  };
  const setRefreshCookie = (res: Response, token: string) =>
    res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: REFRESH_COOKIE_MAX_AGE_MS });
  const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, cookieOptions);
  const startSession = (res: Response, session: Session) => {
    setRefreshCookie(res, session.refresh_token);
    return toSessionResponse(session);
  };

  // Blocks cross-site form posts against the cookie-based endpoints.
  const requireClientHeader: RequestHandler = (req, _res, next) => {
    if (req.get(CLIENT_HEADER) !== "web") {
      return next(new HttpError(403, "forbidden", "Request blocked."));
    }
    next();
  };

  // Stricter limit for endpoints that check passwords or send email.
  const sensitiveLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(tooManyAttempts()),
  });

  router.use(requireClientHeader);

  /** Create an account. Same response whether or not the email is already registered. */
  router.post("/register", sensitiveLimit, async (req, res) => {
    const body = parse(registerSchema, req.body);
    const { data, error } = await supabase.auth().auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        emailRedirectTo: config.supabase.authRedirectUrl,
        data: body.displayName ? { display_name: body.displayName } : {},
      },
    });

    if (error) {
      if (error.code === "user_already_exists" || error.code === "email_exists") {
        res.status(202).json(VERIFY_EMAIL_RESPONSE);
        return;
      }
      if (isRateLimited(error)) throw tooManyAttempts();
      if (error.code === "weak_password") {
        throw new HttpError(400, "weak_password", "Choose a stronger password.", {
          password: "This password is too easy to guess. Try a longer one.",
        });
      }
      if (error.code === "email_address_invalid") {
        throw new HttpError(400, "validation_error", "Please check the highlighted fields.", {
          email: "This email address can't be used.",
        });
      }
      if (error.code === "signup_disabled") {
        throw new HttpError(403, "signup_disabled", "New sign-ups are currently closed.");
      }
      console.warn(`[auth] register failed: ${error.code ?? error.status}`);
      throw new HttpError(502, "auth_unavailable", "We couldn't create your account right now. Please try again later.");
    }

    if (data.session) {
      // Email confirmation is switched off in Supabase: the user is signed in straight away.
      res.status(201).json({ status: "signed_in", session: startSession(res, data.session) });
      return;
    }
    res.status(202).json(VERIFY_EMAIL_RESPONSE);
  });

  /** Sign in with email and password. */
  router.post("/login", sensitiveLimit, async (req, res) => {
    const body = parse(loginSchema, req.body);
    const { data, error } = await supabase.auth().auth.signInWithPassword(body);

    if (error) {
      if (error.code === "email_not_confirmed") {
        throw new HttpError(
          403,
          "email_not_confirmed",
          "Please verify your email first. Check your inbox for the link, or send a new one.",
        );
      }
      if (isRateLimited(error)) throw tooManyAttempts();
      if (error.status && error.status >= 500) throw authUnavailable();
      throw new HttpError(401, "invalid_credentials", "Incorrect email or password.");
    }
    if (!data.session) throw authUnavailable();

    res.json({ session: startSession(res, data.session) });
  });

  /** Exchange the httpOnly refresh cookie for a new access token. */
  router.post("/refresh", async (req, res) => {
    const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof refreshToken !== "string" || !refreshToken) {
      throw new HttpError(401, "no_session", "Please sign in.");
    }

    const { data, error } = await supabase.auth().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      if (error && error.status && error.status >= 500) throw authUnavailable();
      clearRefreshCookie(res);
      throw new HttpError(401, "session_expired", "Your session has expired. Please sign in again.");
    }

    res.json({ session: startSession(res, data.session) });
  });

  /**
   * Start a session from the tokens in an email link (after verifying an email address).
   * The refresh token is checked with Supabase before it is trusted.
   */
  router.post("/session", async (req, res) => {
    const body = parse(sessionSchema, req.body);
    const { data, error } = await supabase.auth().auth.refreshSession({ refresh_token: body.refreshToken });
    if (error || !data.session) {
      throw new HttpError(401, "link_invalid", "This link has expired or was already used. Please sign in.");
    }
    res.json({ session: startSession(res, data.session) });
  });

  /** Sign out: revoke the session in Supabase and clear the cookie. */
  router.post("/logout", async (req, res) => {
    let accessToken = getBearerToken(req);
    const refreshToken: unknown = req.cookies?.[REFRESH_COOKIE];

    if (!accessToken && typeof refreshToken === "string" && refreshToken) {
      const { data } = await supabase.auth().auth.refreshSession({ refresh_token: refreshToken });
      accessToken = data.session?.access_token ?? null;
    }
    if (accessToken) {
      await supabase.admin.auth.admin.signOut(accessToken, "local").catch(() => undefined);
    }

    clearRefreshCookie(res);
    res.status(204).end();
  });

  /** Send a password-reset email. Never reveals whether the account exists. */
  router.post("/forgot-password", sensitiveLimit, async (req, res) => {
    const body = parse(emailOnlySchema, req.body);
    const { error } = await supabase.auth().auth.resetPasswordForEmail(body.email, {
      redirectTo: config.supabase.authRedirectUrl,
    });
    if (error) {
      if (isRateLimited(error)) throw tooManyAttempts();
      console.warn(`[auth] reset email failed: ${error.code ?? error.status}`);
    }
    res.json(RESET_EMAIL_RESPONSE);
  });

  /** Send a new verification email. Never reveals whether the account exists. */
  router.post("/resend-verification", sensitiveLimit, async (req, res) => {
    const body = parse(emailOnlySchema, req.body);
    const { error } = await supabase.auth().auth.resend({
      type: "signup",
      email: body.email,
      options: { emailRedirectTo: config.supabase.authRedirectUrl },
    });
    if (error) {
      if (isRateLimited(error)) throw tooManyAttempts();
      console.warn(`[auth] resend verification failed: ${error.code ?? error.status}`);
    }
    res.json({ message: "If that account still needs verifying, we've sent a new link." });
  });

  /**
   * Set a new password using the token from a password-reset email.
   * Only accepts tokens that came from an email link (amr = otp/recovery), not normal
   * sign-in tokens, then signs out every other session and starts a fresh one.
   */
  router.post("/reset-password", sensitiveLimit, async (req, res) => {
    const recoveryToken = getBearerToken(req);
    if (!recoveryToken) {
      throw new HttpError(401, "reset_link_invalid", "This reset link is invalid. Please request a new one.");
    }
    const body = parse(resetSchema, req.body);

    const { data: userData, error: userError } = await supabase.auth().auth.getUser(recoveryToken);
    if (userError || !userData.user) {
      throw new HttpError(401, "reset_link_invalid", "This reset link has expired. Please request a new one.");
    }

    const now = Math.floor(Date.now() / 1000);
    const fromEmailLink = authMethods(recoveryToken).some(
      (m) => (m.method === "otp" || m.method === "recovery") && now - m.timestamp <= RESET_LINK_MAX_AGE_S,
    );
    if (!fromEmailLink) {
      throw new HttpError(403, "reset_link_invalid", "Please use the link from your password-reset email.");
    }

    const user = userData.user;
    const { error: updateError } = await supabase.admin.auth.admin.updateUserById(user.id, {
      password: body.password,
    });
    if (updateError) {
      if (updateError.code === "weak_password") {
        throw new HttpError(400, "weak_password", "Choose a stronger password.", {
          password: "This password is too easy to guess. Try a longer one.",
        });
      }
      if (updateError.code === "same_password") {
        throw new HttpError(400, "same_password", "Choose a different password.", {
          password: "Your new password must be different from your old one.",
        });
      }
      console.warn(`[auth] password update failed: ${updateError.code ?? updateError.status}`);
      throw authUnavailable();
    }

    // End every existing session (including the reset link's), then start a fresh one.
    await supabase.admin.auth.admin.signOut(recoveryToken, "global").catch(() => undefined);

    if (user.email) {
      const { data } = await supabase.auth().auth.signInWithPassword({ email: user.email, password: body.password });
      if (data.session) {
        res.json({ status: "password_updated", session: startSession(res, data.session) });
        return;
      }
    }
    clearRefreshCookie(res);
    res.json({ status: "password_updated" });
  });

  /** The signed-in user's profile. */
  router.get("/me", requireAuth(supabase), async (req: Request, res) => {
    const auth = req.auth!;
    const { data, error } = await auth.db
      .from("user_preferences")
      .select("display_name, currency, setup_completed_at")
      .maybeSingle();
    if (error) throw new HttpError(502, "profile_unavailable", "We couldn't load your profile. Please try again.");

    res.json({
      user: {
        id: auth.userId,
        email: auth.email ?? null,
        displayName: data?.display_name ?? null,
        currency: data?.currency ?? "ZAR",
        setupCompleted: Boolean(data?.setup_completed_at),
      },
    });
  });

  return router;
}
