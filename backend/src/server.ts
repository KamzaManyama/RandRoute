import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { createSupabaseClients } from "./lib/supabase.js";
import { createGeminiService } from "./lib/gemini.js";
import { createApp } from "./app.js";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = createApp({
  config,
  supabase: createSupabaseClients(config.supabase),
  gemini: createGeminiService(config.ai),
});

app.listen(config.port, () => {
  console.log(`RandRoute API listening on http://localhost:${config.port}`);
  console.log(`AI explanations: ${config.ai.enabled ? "enabled" : "disabled"}`);
});
