import "dotenv/config";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createSupabaseClients } from "./lib/supabase.js";
import { createGeminiService } from "./lib/gemini.js";
import { createApp } from "./createApp.js";

/** Reads config from the environment and builds the Express app (no network listening). */
export function buildApp(): { app: ReturnType<typeof createApp>; config: AppConfig } {
  const config = loadConfig();
  const app = createApp({
    config,
    supabase: createSupabaseClients(config.supabase),
    gemini: createGeminiService(config.ai),
  });
  return { app, config };
}
