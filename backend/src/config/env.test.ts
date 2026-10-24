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
    expect(config.frontendOrigins).toEqual(["http://localhost:5173"]);
    expect(config.ai.enabled).toBe(false);
  });

  it("lists every missing Supabase setting", () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL[\s\S]*SUPABASE_PUBLISHABLE_KEY[\s\S]*SUPABASE_SECRET_KEY/);
  });

  it("refuses to enable AI without a Gemini key", () => {
    expect(() => loadConfig({ ...validEnv, AI_ENABLED: "true" })).toThrow(/GEMINI_API_KEY/);
  });

  it("splits multiple frontend origins", () => {
    const config = loadConfig({ ...validEnv, FRONTEND_ORIGIN: "http://localhost:5173, https://randroute.app" });
    expect(config.frontendOrigins).toEqual(["http://localhost:5173", "https://randroute.app"]);
  });
});
