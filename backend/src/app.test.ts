import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
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
    const res = await request(buildApp()).get("/api/nope");
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
    const allowed = await request(buildApp()).get("/api/health").set("Origin", "http://localhost:5173");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const blocked = await request(buildApp()).get("/api/health").set("Origin", "https://evil.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
