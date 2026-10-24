import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FRONTEND_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  SUPABASE_URL: z.url({ error: "missing or invalid — use your project URL, e.g. https://xyz.supabase.co" }),
  SUPABASE_ANON_KEY: z.string({ error: "missing — copy the anon/publishable key from Supabase" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  SUPABASE_SERVICE_ROLE_KEY: z.string({ error: "missing — copy the service_role/secret key from Supabase" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  AUTH_REDIRECT_URL: z.url().default("http://localhost:5173/auth/callback"),

  AI_ENABLED: booleanString,
  GEMINI_API_KEY: z.string().optional().transform((value) => (value ? value : undefined)),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
});

export type AppConfig = {
  port: number;
  nodeEnv: "development" | "test" | "production";
  frontendOrigins: string[];
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    authRedirectUrl: string;
  };
  ai: {
    enabled: boolean;
    geminiApiKey?: string;
    geminiModel: string;
  };
};

/** Reads and validates environment variables. Throws a readable error listing what is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid backend configuration. Check backend/.env:\n${problems}`);
  }

  const e = parsed.data;
  if (e.AI_ENABLED && !e.GEMINI_API_KEY) {
    throw new Error("AI_ENABLED=true but GEMINI_API_KEY is empty. Add the key or set AI_ENABLED=false.");
  }

  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    frontendOrigins: e.FRONTEND_ORIGIN,
    supabase: {
      url: e.SUPABASE_URL,
      anonKey: e.SUPABASE_ANON_KEY,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      authRedirectUrl: e.AUTH_REDIRECT_URL,
    },
    ai: {
      enabled: e.AI_ENABLED,
      geminiApiKey: e.GEMINI_API_KEY,
      geminiModel: e.GEMINI_MODEL,
    },
  };
}
