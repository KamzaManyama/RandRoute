import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import type { SessionCookies } from "../lib/sessionCookies.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { limiter, securityLog, WINDOWS } from "../middleware/security.js";

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
  acceptedPolicies: z.literal(true, {
    error: "Please confirm you've read the privacy, data retention and cookie policies.",
  }),
});

/** Bump when the Privacy, Data Retention or Cookie policy changes meaningfully. */
export const POLICIES_VERSION = "2026-10-24";
const loginSchema = z.object({
  email,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(200),
});
const emailOnlySchema = z.object({ email });
const resetSchema = z.object({ password: newPassword });
const sessionSchema = z.object({ refreshToken: z.string().min(10).max(4000) });
const recoverySchema = z.object({ accessToken: z.string().min(10).max(4000) });
const verifySchema = z.object({
  tokenHash: z.string().min(10).max(500).regex(/^[A-Za-z0-9_-]+$/, "Invalid link."),
  type: z.enum(["signup", "email", "recovery", "email_change", "invite", "magiclink"]),
});

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
/**
 * The only user details an auth response carries. No user ID, email or token:
 * the session itself lives in HttpOnly cookies (SECURITY.md 5.2, 12.2).
 */
type PublicUser = { displayName: string | null };

function publicUser(user: User): PublicUser {
  const name = user.user_metadata?.display_name;
  return { displayName: typeof name === "string" && name ? name : null };
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

/** True when the token came from an email link (OTP / recovery) opened recently. */
function fromRecentEmailLink(accessToken: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  return authMethods(accessToken).some(
    (m) => (m.method === "otp" || m.method === "recovery") && now - m.timestamp <= RESET_LINK_MAX_AGE_S,
  );
}

const VERIFY_EMAIL_RESPONSE = {
  status: "verification_required",
  message:
    "Check your inbox for a link to verify your email address. If you already have an account, sign in instead.",
} as const;

const RESET_EMAIL_RESPONSE = {
  message: "If an account exists for that email, we've sent a link to reset your password.",
} as const;

const linkInvalid = () => new HttpError(401, "link_invalid", "This link has expired or was already used. Please sign in.");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export function authRouter({ config, supabase, cookies }: { config: AppConfig; supabase: SupabaseClients; cookies: SessionCookies }): Router {
  const router = Router();

  /** Puts the session in HttpOnly cookies and returns only the display name. */
  const startSession = (res: Response, session: Session) => {
    cookies.set(res, session);
    return { signedIn: true as const, user: publicUser(session.user) };
  };

  // SECURITY.md 15.1 — per-IP limits on auth endpoints.
  const window15 = 15 * WINDOWS.MINUTE;
  const loginLimit = limiter({ name: "login", windowMs: window15, limit: 10, by: "ip", message: "Too many sign-in attempts. Please wait 15 minutes and try again." });
  const signupLimit = limiter({ name: "signup", windowMs: window15, limit: 5, by: "ip", message: "Too many sign-up attempts. Please wait 15 minutes and try again." });
  const resetLimit = limiter({ name: "password_reset", windowMs: window15, limit: 5, by: "ip", message: "Too many password-reset attempts. Please wait 15 minutes and try again." });
  const recoveryLimit = limiter({ name: "account_recovery", windowMs: window15, limit: 5, by: "ip", message: "Too many attempts. Please wait 15 minutes and try again." });
  const linkLimit = limiter({ name: "email_link", windowMs: window15, limit: 10, by: "ip", message: "Too many attempts. Please wait 15 minutes and try again." });

  /** CSRF token for this browser (also sets the HttpOnly CSRF cookie). Not an auth token. */
  router.get("/csrf", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ csrfToken: cookies.csrf(req, res) });
  });

  /** Create an account. Same response whether or not the email is already registered. */
  router.post("/register", signupLimit, async (req, res) => {
    const body = parse(registerSchema, req.body);
    const { data, error } = await supabase.auth().auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        emailRedirectTo: config.supabase.authRedirectUrl,
        data: {
          ...(body.displayName ? { display_name: body.displayName } : {}),
          // Record which version of the policies they agreed to, and when.
          policies_version: POLICIES_VERSION,
          policies_accepted_at: new Date().toISOString(),
        },
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
      res.status(201).json({ status: "signed_in", ...startSession(res, data.session) });
      return;
    }
    res.status(202).json(VERIFY_EMAIL_RESPONSE);
  });

  /** Sign in with email and password. */
  router.post("/login", loginLimit, async (req, res) => {
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
      securityLog("login_failed", req);
      throw new HttpError(401, "invalid_credentials", "Incorrect email or password.");
    }
    if (!data.session) throw authUnavailable();

    res.json(startSession(res, data.session));
  });

  /** Exchange the HttpOnly refresh cookie for new session cookies (refresh tokens rotate). */
  router.post("/refresh", async (req, res) => {
    const refreshToken = cookies.refreshToken(req);
    if (!refreshToken) {
      throw new HttpError(401, "no_session", "Please sign in.");
    }

    const { data, error } = await supabase.auth().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      if (error && error.status && error.status >= 500) throw authUnavailable();
      // Expired, revoked, or a reused (rotated-out) refresh token.
      cookies.clear(res);
      throw new HttpError(401, "session_expired", "Your session has expired. Please sign in again.");
    }

    res.json(startSession(res, data.session));
  });

  /**
   * Open an email link that carries a one-time `token_hash` (recommended
   * Supabase email templates). No session token ever appears in the URL.
   * Recovery links get a short-lived reset cookie instead of a session.
   */
  router.post("/verify", linkLimit, async (req, res) => {
    const body = parse(verifySchema, req.body);
    const { data, error } = await supabase.auth().auth.verifyOtp({ token_hash: body.tokenHash, type: body.type });
    if (error || !data.session) {
      if (error && isRateLimited(error)) throw tooManyAttempts();
      throw linkInvalid();
    }
    if (body.type === "recovery") {
      cookies.setRecovery(res, data.session.access_token);
      res.json({ next: "reset_password" });
      return;
    }
    res.json({ next: "signed_in", type: body.type, ...startSession(res, data.session) });
  });

  /**
   * Older email links put tokens in the URL fragment. The page sends the
   * refresh token here straight away (it is never stored in the browser), and
   * it is checked with Supabase before it is trusted.
   */
  router.post("/session", linkLimit, async (req, res) => {
    const body = parse(sessionSchema, req.body);
    const { data, error } = await supabase.auth().auth.refreshSession({ refresh_token: body.refreshToken });
    if (error || !data.session) throw linkInvalid();
    res.json(startSession(res, data.session));
  });

  /** Older password-reset links: swap the link's token for a short-lived HttpOnly reset cookie. */
  router.post("/recovery", recoveryLimit, async (req, res) => {
    const body = parse(recoverySchema, req.body);
    const { data, error } = await supabase.auth().auth.getUser(body.accessToken);
    if (error || !data.user) {
      throw new HttpError(401, "reset_link_invalid", "This reset link has expired. Please request a new one.");
    }
    if (!fromRecentEmailLink(body.accessToken)) {
      throw new HttpError(403, "reset_link_invalid", "Please use the link from your password-reset email.");
    }
    cookies.setRecovery(res, body.accessToken);
    res.json({ next: "reset_password" });
  });

  /** Is a password-reset link open in this browser? (The reset page asks on load.) */
  router.get("/recovery", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ready: Boolean(cookies.recoveryToken(req)) });
  });

  /** Sign out: revoke the session in Supabase and clear every auth cookie. */
  router.post("/logout", async (req, res) => {
    let accessToken = cookies.accessToken(req);
    const refreshToken = cookies.refreshToken(req);

    if (!accessToken && refreshToken) {
      const { data } = await supabase.auth().auth.refreshSession({ refresh_token: refreshToken });
      accessToken = data.session?.access_token ?? null;
    }
    if (accessToken) {
      // Revokes this session's refresh token, so the old cookies stop working everywhere.
      await supabase.admin.auth.admin.signOut(accessToken, "local").catch(() => undefined);
    }

    cookies.clear(res);
    cookies.rotateCsrf(res);
    res.status(204).end();
  });

  /** Send a password-reset email. Never reveals whether the account exists. */
  router.post("/forgot-password", resetLimit, async (req, res) => {
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
  router.post("/resend-verification", recoveryLimit, async (req, res) => {
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
   * Set a new password using the HttpOnly reset cookie from a password-reset
   * link. Only accepts tokens that came from an email link (amr = otp/recovery),
   * then signs out every session and starts a fresh one.
   */
  router.post("/reset-password", resetLimit, async (req, res) => {
    const recoveryToken = cookies.recoveryToken(req);
    if (!recoveryToken) {
      throw new HttpError(401, "reset_link_invalid", "This reset link is invalid. Please request a new one.");
    }
    const body = parse(resetSchema, req.body);

    const { data: userData, error: userError } = await supabase.auth().auth.getUser(recoveryToken);
    if (userError || !userData.user) {
      cookies.clearRecovery(res);
      throw new HttpError(401, "reset_link_invalid", "This reset link has expired. Please request a new one.");
    }
    if (!fromRecentEmailLink(recoveryToken)) {
      cookies.clearRecovery(res);
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
    cookies.clear(res);

    if (user.email) {
      const { data } = await supabase.auth().auth.signInWithPassword({ email: user.email, password: body.password });
      if (data.session) {
        res.json({ status: "password_updated", ...startSession(res, data.session) });
        return;
      }
    }
    res.json({ status: "password_updated" });
  });

  /** The signed-in user's basic profile. No user ID or email. */
  router.get("/me", requireAuth(supabase), async (req: Request, res) => {
    const auth = req.auth!;
    const { data, error } = await auth.db
      .from("user_preferences")
      .select("display_name, currency, setup_completed_at")
      .maybeSingle();
    if (error) throw new HttpError(502, "profile_unavailable", "We couldn't load your profile. Please try again.");

    res.json({
      user: {
        displayName: data?.display_name ?? null,
        currency: data?.currency ?? "ZAR",
        setupCompleted: Boolean(data?.setup_completed_at),
      },
    });
  });

  return router;
}
