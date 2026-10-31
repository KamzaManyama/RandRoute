import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../createApp.js";
import { loadConfig } from "../config/env.js";
import { createGeminiService } from "../lib/gemini.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { asWebApp, TEST_CSRF } from "../test/session.js";

const config = loadConfig({
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
});

const USER = { id: "user-1", email: "maredi@example.com", user_metadata: { display_name: "Maredi" } };

function fakeJwt(amr: { method: string; timestamp: number }[]) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc({ sub: USER.id, amr })}.sig`;
}

function session(refresh = "refresh-1", access = "access-1") {
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: 2_000_000_000, user: USER };
}

const authError = (code: string, status = 400) => ({ code, status, message: code });

// Shared mocks, reset before each test.
const auth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  refreshSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
};
const adminAuth = { signOut: vi.fn(), updateUserById: vi.fn() };
const prefsQuery = { maybeSingle: vi.fn() };

const supabase = {
  auth: () => ({ auth }),
  forUser: () => ({ from: () => ({ select: () => prefsQuery }) }),
  admin: { auth: { admin: adminAuth } },
} as unknown as SupabaseClients;

const app = () => createApp({ config, supabase, gemini: createGeminiService(config.ai) });
/** A web-app request with no session yet (CSRF token, no access cookie). */
const post = (path: string, body?: object, cookies: string[] = []) =>
  asWebApp(request(app()).post(`/api/auth${path}`), { access: null, cookies }).send(body);

const setCookies = (res: request.Response) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const cookie = (res: request.Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));
const cleared = /Expires=Thu, 01 Jan 1970/;

/** No response body may ever carry a token, the user's ID or email. */
function expectNoSecrets(res: request.Response) {
  const body = JSON.stringify(res.body ?? {});
  for (const secret of ["access-1", "access-2", "access-new", "refresh-1", "refresh-2", "refresh-new", USER.id, USER.email, "accessToken", "expiresAt"]) {
    expect(body).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  adminAuth.signOut.mockResolvedValue({ error: null });
});

describe("cross-site protection", () => {
  it("rejects auth calls without the client header", async () => {
    const res = await request(app()).post("/api/auth/login").set("Cookie", `rr_csrf=${TEST_CSRF}`).set("X-CSRF-Token", TEST_CSRF).send({ email: USER.email, password: "x" });
    expect(res.status).toBe(403);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects sign-in without a matching CSRF token", async () => {
    const missing = await asWebApp(request(app()).post("/api/auth/login"), { access: null, csrf: false }).send({ email: USER.email, password: "x" });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe("csrf_invalid");
    const wrong = await asWebApp(request(app()).post("/api/auth/login"), { access: null, csrf: false })
      .set("X-CSRF-Token", "d".repeat(43))
      .send({ email: USER.email, password: "x" });
    expect(wrong.status).toBe(403);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects requests from another site", async () => {
    const res = await post("/login", { email: USER.email, password: "x" }).set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("issues a CSRF token in an HttpOnly cookie", async () => {
    const res = await request(app()).get("/api/auth/csrf").set("X-RandRoute-Client", "web");
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = cookie(res, "rr_csrf")!;
    expect(c).toContain(res.body.csrfToken);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
  });

  it("keeps the CSRF token stable for this browser", async () => {
    const res = await request(app()).get("/api/auth/csrf").set("X-RandRoute-Client", "web").set("Cookie", `rr_csrf=${TEST_CSRF}`);
    expect(res.body.csrfToken).toBe(TEST_CSRF);
    expect(cookie(res, "rr_csrf")).toBeUndefined();
  });
});

describe("POST /register", () => {
  it("validates input with per-field messages", async () => {
    const res = await post("/register", { email: "not-an-email", password: "short", acceptedPolicies: true });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("requires agreeing to the policies", async () => {
    const res = await post("/register", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.acceptedPolicies).toMatch(/privacy, data retention and cookie policies/);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("requires a letter and a number in the password", async () => {
    const res = await post("/register", { email: USER.email, password: "onlyletters", acceptedPolicies: true });
    expect(res.body.error.fields.password).toMatch(/letter and one number/);
  });

  it("asks the user to verify their email, normalising the address", async () => {
    auth.signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null });
    const res = await post("/register", { email: "  Maredi@Example.com ", password: "Passw0rd!", displayName: "Maredi", acceptedPolicies: true });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verification_required");
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "maredi@example.com",
        options: expect.objectContaining({
          data: expect.objectContaining({ display_name: "Maredi", policies_version: "2026-10-24" }),
          emailRedirectTo: config.supabase.authRedirectUrl,
        }),
      }),
    );
  });

  it("gives the same answer when the email is already registered", async () => {
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError("user_already_exists", 422) });
    const res = await post("/register", { email: USER.email, password: "Passw0rd!", acceptedPolicies: true });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verification_required");
  });

  it("signs in immediately when email confirmation is off, using cookies only", async () => {
    auth.signUp.mockResolvedValue({ data: { user: USER, session: session() }, error: null });
    const res = await post("/register", { email: USER.email, password: "Passw0rd!", acceptedPolicies: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: "signed_in", signedIn: true, user: { displayName: "Maredi" } });
    expect(cookie(res, "rr_access")).toMatch(/^rr_access=access-1/);
    expect(cookie(res, "rr_refresh")).toBeDefined();
    expectNoSecrets(res);
  });

  it("allows 5 sign-ups per 15 minutes per IP", async () => {
    auth.signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null });
    const a = app();
    const send = () => asWebApp(request(a).post("/api/auth/register"), { access: null }).send({ email: USER.email, password: "Passw0rd!", acceptedPolicies: true });
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(202);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("POST /login", () => {
  it("puts the session in HttpOnly cookies and returns only the display name", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
    const res = await post("/login", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ signedIn: true, user: { displayName: "Maredi" } });
    expectNoSecrets(res);

    const access = cookie(res, "rr_access")!;
    expect(access).toMatch(/^rr_access=access-1;/);
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/Path=\//);
    expect(access).toMatch(/SameSite=Strict/i);
    expect(access).toMatch(/Max-Age=3600/);

    const refresh = cookie(res, "rr_refresh")!;
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\/api\/auth/);
    expect(refresh).toMatch(/SameSite=Strict/i);
  });

  it("uses one generic message for wrong email or password", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: authError("invalid_credentials") });
    const res = await post("/login", { email: USER.email, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ code: "invalid_credentials", message: "Incorrect email or password." });
  });

  it("tells unverified users to check their email", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: authError("email_not_confirmed") });
    const res = await post("/login", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("email_not_confirmed");
  });

  it("passes on Supabase rate limits as 429", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: authError("over_request_rate_limit", 429) });
    const res = await post("/login", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(429);
  });

  it("allows 10 sign-in attempts per 15 minutes per IP", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: authError("invalid_credentials") });
    const a = app();
    const send = () => asWebApp(request(a).post("/api/auth/login"), { access: null }).send({ email: USER.email, password: "wrong" });
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(429);
  });
});

describe("POST /refresh", () => {
  it("needs the refresh cookie", async () => {
    const res = await post("/refresh");
    expect(res.status).toBe(401);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("rotates both cookies and returns no tokens", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: session("refresh-2", "access-2") }, error: null });
    const res = await post("/refresh", undefined, ["rr_refresh=refresh-1"]);
    expect(res.status).toBe(200);
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: "refresh-1" });
    expect(cookie(res, "rr_refresh")).toMatch(/^rr_refresh=refresh-2/);
    expect(cookie(res, "rr_access")).toMatch(/^rr_access=access-2/);
    expectNoSecrets(res);
  });

  it("clears every session cookie when the session has expired or been revoked", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: authError("refresh_token_not_found") });
    const res = await post("/refresh", undefined, ["rr_refresh=old"]);
    expect(res.status).toBe(401);
    expect(cookie(res, "rr_refresh")).toMatch(cleared);
    expect(cookie(res, "rr_access")).toMatch(cleared);
  });
});

describe("POST /logout", () => {
  it("revokes the session in Supabase and clears every auth cookie", async () => {
    const res = await post("/logout", undefined, ["rr_access=access-1", "rr_refresh=refresh-1"]);
    expect(res.status).toBe(204);
    expect(adminAuth.signOut).toHaveBeenCalledWith("access-1", "local");
    expect(cookie(res, "rr_refresh")).toMatch(cleared);
    expect(cookie(res, "rr_access")).toMatch(cleared);
    expect(cookie(res, "rr_csrf")).not.toContain(TEST_CSRF); // a fresh CSRF token
  });

  it("ignores a Bearer header", async () => {
    const res = await post("/logout").set("Authorization", "Bearer access-1");
    expect(res.status).toBe(204);
    expect(adminAuth.signOut).not.toHaveBeenCalled();
  });
});

describe("email links", () => {
  it("opens a token_hash link and signs in with cookies", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: session(), user: USER }, error: null });
    const res = await post("/verify", { tokenHash: "pkce_abcdef0123456789", type: "signup" });
    expect(res.status).toBe(200);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "pkce_abcdef0123456789", type: "signup" });
    expect(res.body).toEqual({ next: "signed_in", type: "signup", signedIn: true, user: { displayName: "Maredi" } });
    expect(cookie(res, "rr_access")).toBeDefined();
    expectNoSecrets(res);
  });

  it("turns a recovery link into a short-lived HttpOnly reset cookie, not a session", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: session(), user: USER }, error: null });
    const res = await post("/verify", { tokenHash: "pkce_abcdef0123456789", type: "recovery" });
    expect(res.body).toEqual({ next: "reset_password" });
    const recovery = cookie(res, "rr_recovery")!;
    expect(recovery).toMatch(/HttpOnly/i);
    expect(recovery).toMatch(/Path=\/api\/auth/);
    expect(recovery).toMatch(/Max-Age=900/);
    expect(cookie(res, "rr_access")).toBeUndefined();
  });

  it("explains an expired or used link", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: authError("otp_expired", 403) });
    const res = await post("/verify", { tokenHash: "pkce_abcdef0123456789", type: "signup" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("link_invalid");
  });

  it("only takes a recent email-link token for older recovery links", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const normal = await post("/recovery", { accessToken: fakeJwt([{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]) });
    expect(normal.status).toBe(403);
    const ok = await post("/recovery", { accessToken: fakeJwt([{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) }]) });
    expect(ok.status).toBe(200);
    expect(cookie(ok, "rr_recovery")).toBeDefined();
  });
});

describe("POST /forgot-password", () => {
  it("always gives the same answer and uses the callback URL", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: authError("user_not_found", 404) });
    const res = await post("/forgot-password", { email: USER.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(USER.email, { redirectTo: config.supabase.authRedirectUrl });
  });

  it("validates the email", async () => {
    const res = await post("/forgot-password", { email: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBe("Enter your email address.");
  });

  it("allows 5 reset requests per 15 minutes per IP", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const a = app();
    const send = () => asWebApp(request(a).post("/api/auth/forgot-password"), { access: null }).send({ email: USER.email });
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});

describe("POST /reset-password", () => {
  const now = () => Math.floor(Date.now() / 1000);
  const withRecovery = (token: string) => post("/reset-password", { password: "NewPassw0rd" }, [`rr_recovery=${token}`]);

  it("needs the reset cookie from the email link", async () => {
    const res = await post("/reset-password", { password: "NewPassw0rd" });
    expect(res.status).toBe(401);
  });

  it("refuses a normal sign-in token", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const res = await withRecovery(fakeJwt([{ method: "password", timestamp: now() }]));
    expect(res.status).toBe(403);
    expect(adminAuth.updateUserById).not.toHaveBeenCalled();
  });

  it("refuses an old reset link", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const res = await withRecovery(fakeJwt([{ method: "otp", timestamp: now() - 2 * 60 * 60 }]));
    expect(res.status).toBe(403);
  });

  it("updates the password, signs out every session, and signs in with fresh cookies", async () => {
    const token = fakeJwt([{ method: "otp", timestamp: now() }]);
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    adminAuth.updateUserById.mockResolvedValue({ data: { user: USER }, error: null });
    auth.signInWithPassword.mockResolvedValue({ data: { session: session("refresh-new", "access-new") }, error: null });

    const res = await withRecovery(token);

    expect(res.status).toBe(200);
    expect(adminAuth.updateUserById).toHaveBeenCalledWith("user-1", { password: "NewPassw0rd" });
    expect(adminAuth.signOut).toHaveBeenCalledWith(token, "global");
    expect(res.body).toEqual({ status: "password_updated", signedIn: true, user: { displayName: "Maredi" } });
    expect(setCookies(res).some((c) => c.startsWith("rr_refresh=refresh-new"))).toBe(true);
    expect(setCookies(res).some((c) => c.startsWith("rr_recovery=") && cleared.test(c))).toBe(true);
    expectNoSecrets(res);
  });

  it("explains when the new password matches the old one", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    adminAuth.updateUserById.mockResolvedValue({ data: null, error: authError("same_password", 422) });
    const res = await withRecovery(fakeJwt([{ method: "otp", timestamp: now() }]));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toMatch(/different/);
  });
});

describe("GET /me", () => {
  it("requires a signed-in user", async () => {
    const res = await asWebApp(request(app()).get("/api/auth/me"), { access: null });
    expect(res.status).toBe(401);
  });

  it("does not accept a Bearer token instead of the cookie", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const res = await asWebApp(request(app()).get("/api/auth/me"), { access: null }).set("Authorization", "Bearer access-1");
    expect(res.status).toBe(401);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("returns the profile without the user ID or email", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    prefsQuery.maybeSingle.mockResolvedValue({
      data: { display_name: "Maredi Manyama", currency: "ZAR", setup_completed_at: null },
      error: null,
    });
    const res = await asWebApp(request(app()).get("/api/auth/me"), { access: "access-1" });
    expect(res.status).toBe(200);
    expect(auth.getUser).toHaveBeenCalledWith("access-1");
    expect(res.body.user).toEqual({ displayName: "Maredi Manyama", currency: "ZAR", setupCompleted: false });
    expectNoSecrets(res);
  });
});
