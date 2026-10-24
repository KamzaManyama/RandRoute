import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const validEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
};

describe("loadConfig", () => {
  it("applies safe defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.port).toBe(4000);
    expect(config.frontendOrigins).toEqual(["http://localhost:4173"]);
    expect(config.ai.enabled).toBe(false);
  });

  it("lists every missing Supabase setting", () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_PUBLISHABLE_KEY[\s\S]*SUPABASE_SECRET_KEY/);
  });

  it("refuses to enable AI without a Gemini key", () => {
    expect(() => loadConfig({ ...validEnv, AI_ENABLED: "true" })).toThrow(/GEMINI_API_KEY/);
  });

  it("splits multiple frontend origins", () => {
    const config = loadConfig({ ...validEnv, FRONTEND_ORIGIN: "http://localhost:4173, https://randroute.app" });
    expect(config.frontendOrigins).toEqual(["http://localhost:4173", "https://randroute.app"]);
  });

  it("treats empty values as not set (e.g. NODE_ENV=)", () => {
    const config = loadConfig({ ...validEnv, NODE_ENV: "", PORT: "", AI_ENABLED: "" });
    expect(config.nodeEnv).toBe("development");
    expect(config.port).toBe(4000);
    expect(config.ai.enabled).toBe(false);
  });

  it("accepts the older Supabase key names", () => {
    const config = loadConfig({
      SUPABASE_URL: validEnv.SUPABASE_URL,
      SUPABASE_ANON_KEY: "anon-key-0123456789abcdef",
      SUPABASE_SERVICE_ROLE_KEY: "service-key-0123456789abcdef",
    });
    expect(config.supabase.publishableKey).toBe("anon-key-0123456789abcdef");
    expect(config.supabase.secretKey).toBe("service-key-0123456789abcdef");
  });

  it("uses FRONTEND_URL for the allowed origin and the email redirect", () => {
    const config = loadConfig({ ...validEnv, FRONTEND_URL: "https://randroute-two.vercel.app/" });
    expect(config.frontendOrigins).toEqual(["https://randroute-two.vercel.app"]);
    expect(config.supabase.authRedirectUrl).toBe("https://randroute-two.vercel.app/auth/callback");
  });

  it("on Vercel, falls back to the stable production address, not the per-deployment one", () => {
    const config = loadConfig({ ...validEnv, VERCEL_URL: "randroute-abc123.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "randroute-two.vercel.app" });
    expect(config.supabase.authRedirectUrl).toBe("https://randroute-two.vercel.app/auth/callback");
  });

  it("explains a bad FRONTEND_URL", () => {
    expect(() => loadConfig({ ...validEnv, FRONTEND_URL: "not a url" })).toThrow(/FRONTEND_URL/);
  });
});
