import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./createApp.js";
import { loadConfig } from "./config/env.js";
import { createGeminiService } from "./lib/gemini.js";
import type { SupabaseClients } from "./lib/supabase.js";

const config = loadConfig({
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
});

/** Minimal fake of the Supabase query used by /api/health/db. */
function fakeSupabase(result: { count: number | null; error: unknown }): SupabaseClients {
  const query = { select: () => query, is: async () => result };
  return {
    auth: () => {
      throw new Error("not used");
    },
    forUser: () => {
      throw new Error("not used");
    },
    admin: { from: () => query },
  } as unknown as SupabaseClients;
}

function buildApp(dbResult = { count: 24, error: null as unknown }) {
  return createApp({ config, supabase: fakeSupabase(dbResult), gemini: createGeminiService(config.ai) });
}

describe("health routes", () => {
  it("GET /api/health reports ok and AI disabled by default", async () => {
    const res = await request(buildApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", ai: "disabled" });
  });

  it("GET /api/health/db reports the seeded category count", async () => {
    const res = await request(buildApp()).get("/api/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ database: "ok", systemCategories: 24 });
  });

  it("GET /api/health/db returns 503 without leaking error details", async () => {
    const res = await request(buildApp({ count: null, error: { message: "secret internals" } })).get("/api/health/db");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("secret internals");
  });
});

describe("security basics", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(buildApp()).get("/api/nope").set("X-RandRoute-Client", "web");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(buildApp())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });

  it("does not advertise Express and sets security headers", async () => {
    const res = await request(buildApp()).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("only allows the configured frontend origin", async () => {
    const allowed = await request(buildApp()).get("/api/health").set("Origin", "http://localhost:4173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:4173");

    const blocked = await request(buildApp()).get("/api/health").set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("SECURITY.md web controls", () => {
  it("sets the required security headers and never caches API responses", async () => {
    const res = await request(buildApp()).get("/api/health");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=63072000; includeSubDomains; preload/);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not let other sites send the client header or a token header", async () => {
    const res = await request(buildApp()).options("/api/auth/login").set("Origin", "http://localhost:4173").set("Access-Control-Request-Method", "POST");
    const allowed = String(res.headers["access-control-allow-headers"]).toLowerCase();
    expect(allowed).toContain("x-csrf-token");
    expect(allowed).not.toContain("authorization");
  });

  it("blocks state-changing requests from another origin", async () => {
    const res = await request(buildApp()).post("/api/auth/logout").set("Origin", "https://evil.example").set("X-RandRoute-Client", "web");
    expect(res.status).toBe(403);
  });

  it("needs a CSRF token for every state-changing request", async () => {
    const res = await request(buildApp()).post("/api/auth/logout").set("X-RandRoute-Client", "web");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf_invalid");
  });

  it("refuses production config without Secure cookies", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
        SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
        FRONTEND_ORIGIN: "https://randroute.example",
        COOKIE_SECURE: "false",
      }),
    ).toThrow(/Secure/);
  });

  it("does not allow cross-site cookies", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
        SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
        COOKIE_SAMESITE: "none",
      }),
    ).toThrow(/COOKIE_SAMESITE/);
  });
});
