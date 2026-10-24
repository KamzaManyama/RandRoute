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
    .default("http://localhost:4173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  SUPABASE_URL: z.url({ error: "missing or invalid — use your project URL, e.g. https://xyz.supabase.co" }),
  SUPABASE_PUBLISHABLE_KEY: z.string({ error: "missing — copy the publishable key (sb_publishable_...) from Supabase" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  SUPABASE_SECRET_KEY: z.string({ error: "missing — copy the secret key (sb_secret_...) from Supabase" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  SUPABASE_JWKS_URL: z.url().optional(),
  AUTH_REDIRECT_URL: z.url().default("http://localhost:4173/auth/callback"),

  // Refresh-token cookie. Defaults: Secure in production; SameSite=Lax (use "none" only
  // when the frontend and backend are on different sites, which also requires Secure).
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  AI_ENABLED: booleanString,
  GEMINI_API_KEY: z.string().optional().transform((value) => (value ? value : undefined)),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
});

export type AppConfig = {
  port: number;
  nodeEnv: "development" | "test" | "production";
  frontendOrigins: string[];
  supabase: {
    url: string;
    /** sb_publishable_... — safe for auth calls and user-scoped (RLS) queries. */
    publishableKey: string;
    /** sb_secret_... — bypasses RLS. Server only. */
    secretKey: string;
    jwksUrl?: string;
    authRedirectUrl: string;
  };
  cookies: {
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
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

  const cookieSecure = e.COOKIE_SECURE ? e.COOKIE_SECURE === "true" : e.NODE_ENV === "production";
  if (e.COOKIE_SAMESITE === "none" && !cookieSecure) {
    throw new Error("COOKIE_SAMESITE=none requires COOKIE_SECURE=true.");
  }

  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    frontendOrigins: e.FRONTEND_ORIGIN,
    supabase: {
      url: e.SUPABASE_URL,
      publishableKey: e.SUPABASE_PUBLISHABLE_KEY,
      secretKey: e.SUPABASE_SECRET_KEY,
      jwksUrl: e.SUPABASE_JWKS_URL,
      authRedirectUrl: e.AUTH_REDIRECT_URL,
    },
    cookies: {
      secure: cookieSecure,
      sameSite: e.COOKIE_SAMESITE,
    },
    ai: {
      enabled: e.AI_ENABLED,
      geminiApiKey: e.GEMINI_API_KEY,
      geminiModel: e.GEMINI_MODEL,
    },
  };
}
