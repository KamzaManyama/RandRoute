import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { createGeminiService } from "../lib/gemini.js";
import type { SupabaseClients } from "../lib/supabase.js";

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
};
const adminAuth = { signOut: vi.fn(), updateUserById: vi.fn() };
const prefsQuery = { maybeSingle: vi.fn() };

const supabase = {
  auth: () => ({ auth }),
  forUser: () => ({ from: () => ({ select: () => prefsQuery }) }),
  admin: { auth: { admin: adminAuth } },
} as unknown as SupabaseClients;

const app = () => createApp({ config, supabase, gemini: createGeminiService(config.ai) });
const post = (path: string, body?: object) =>
  request(app()).post(`/api/auth${path}`).set("X-RandRoute-Client", "web").send(body);

function refreshCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return cookies.find((c) => c.startsWith("rr_refresh="));
}

beforeEach(() => {
  vi.resetAllMocks();
  adminAuth.signOut.mockResolvedValue({ error: null });
});

describe("cross-site protection", () => {
  it("rejects auth calls without the client header", async () => {
    const res = await request(app()).post("/api/auth/login").send({ email: USER.email, password: "x" });
    expect(res.status).toBe(403);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("POST /register", () => {
  it("validates input with per-field messages", async () => {
    const res = await post("/register", { email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("requires a letter and a number in the password", async () => {
    const res = await post("/register", { email: USER.email, password: "onlyletters" });
    expect(res.body.error.fields.password).toMatch(/letter and one number/);
  });

  it("asks the user to verify their email, normalising the address", async () => {
    auth.signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null });
    const res = await post("/register", { email: "  Maredi@Example.com ", password: "Passw0rd!", displayName: "Maredi" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verification_required");
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "maredi@example.com",
        options: expect.objectContaining({ data: { display_name: "Maredi" }, emailRedirectTo: config.supabase.authRedirectUrl }),
      }),
    );
  });

  it("gives the same answer when the email is already registered", async () => {
    auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: authError("user_already_exists", 422) });
    const res = await post("/register", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verification_required");
  });

  it("signs in immediately when email confirmation is off", async () => {
    auth.signUp.mockResolvedValue({ data: { user: USER, session: session() }, error: null });
    const res = await post("/register", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(201);
    expect(res.body.session.accessToken).toBe("access-1");
    expect(refreshCookie(res)).toBeDefined();
  });
});

describe("POST /login", () => {
  it("returns an access token and sets an httpOnly refresh cookie", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
    const res = await post("/login", { email: USER.email, password: "Passw0rd!" });
    expect(res.status).toBe(200);
    expect(res.body.session).toEqual({
      accessToken: "access-1",
      expiresAt: 2_000_000_000,
      user: { id: "user-1", email: USER.email, displayName: "Maredi" },
    });
    expect(JSON.stringify(res.body)).not.toContain("refresh-1");
    const cookie = refreshCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
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
});

describe("POST /refresh", () => {
  it("needs the refresh cookie", async () => {
    const res = await post("/refresh");
    expect(res.status).toBe(401);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("rotates the cookie and returns a new access token", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: session("refresh-2", "access-2") }, error: null });
    const res = await post("/refresh").set("Cookie", "rr_refresh=refresh-1");
    expect(res.status).toBe(200);
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: "refresh-1" });
    expect(res.body.session.accessToken).toBe("access-2");
    expect(refreshCookie(res)).toMatch(/^rr_refresh=refresh-2/);
  });

  it("clears the cookie when the session has expired", async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: authError("refresh_token_not_found") });
    const res = await post("/refresh").set("Cookie", "rr_refresh=old");
    expect(res.status).toBe(401);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("POST /logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const res = await post("/logout").set("Authorization", "Bearer access-1");
    expect(res.status).toBe(204);
    expect(adminAuth.signOut).toHaveBeenCalledWith("access-1", "local");
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
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
});

describe("POST /reset-password", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("needs the token from the email link", async () => {
    const res = await post("/reset-password", { password: "NewPassw0rd" });
    expect(res.status).toBe(401);
  });

  it("refuses a normal sign-in token", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const token = fakeJwt([{ method: "password", timestamp: now() }]);
    const res = await post("/reset-password", { password: "NewPassw0rd" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(adminAuth.updateUserById).not.toHaveBeenCalled();
  });

  it("refuses an old reset link", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const token = fakeJwt([{ method: "otp", timestamp: now() - 2 * 60 * 60 }]);
    const res = await post("/reset-password", { password: "NewPassw0rd" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("updates the password, signs out other sessions, and signs the user in", async () => {
    const token = fakeJwt([{ method: "otp", timestamp: now() }]);
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    adminAuth.updateUserById.mockResolvedValue({ data: { user: USER }, error: null });
    auth.signInWithPassword.mockResolvedValue({ data: { session: session("refresh-new", "access-new") }, error: null });

    const res = await post("/reset-password", { password: "NewPassw0rd" }).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(adminAuth.updateUserById).toHaveBeenCalledWith("user-1", { password: "NewPassw0rd" });
    expect(adminAuth.signOut).toHaveBeenCalledWith(token, "global");
    expect(res.body.session.accessToken).toBe("access-new");
    expect(refreshCookie(res)).toMatch(/^rr_refresh=refresh-new/);
  });

  it("explains when the new password matches the old one", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    adminAuth.updateUserById.mockResolvedValue({ data: null, error: authError("same_password", 422) });
    const token = fakeJwt([{ method: "otp", timestamp: now() }]);
    const res = await post("/reset-password", { password: "NewPassw0rd" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toMatch(/different/);
  });
});

describe("GET /me", () => {
  it("requires a signed-in user", async () => {
    const res = await request(app()).get("/api/auth/me").set("X-RandRoute-Client", "web");
    expect(res.status).toBe(401);
  });

  it("returns the profile from user_preferences", async () => {
    auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    prefsQuery.maybeSingle.mockResolvedValue({
      data: { display_name: "Maredi Manyama", currency: "ZAR", setup_completed_at: null },
      error: null,
    });
    const res = await request(app())
      .get("/api/auth/me")
      .set("X-RandRoute-Client", "web")
      .set("Authorization", "Bearer access-1");
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: "user-1",
      email: USER.email,
      displayName: "Maredi Manyama",
      currency: "ZAR",
      setupCompleted: false,
    });
  });
});
