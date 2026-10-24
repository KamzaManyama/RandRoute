import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/**
 * Makes the settings forgiving before they're checked:
 * - empty values (e.g. `NODE_ENV=`) count as "not set" instead of failing;
 * - older Supabase names still work (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`);
 * - `FRONTEND_URL` fills in both FRONTEND_ORIGIN and AUTH_REDIRECT_URL.
 */
export function normaliseEnv(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim() !== "") env[key] = value.trim();
  }
  env.SUPABASE_PUBLISHABLE_KEY ??= env.SUPABASE_ANON_KEY;
  env.SUPABASE_SECRET_KEY ??= env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.FRONTEND_URL) {
    let origin: string;
    try {
      origin = new URL(env.FRONTEND_URL).origin;
    } catch {
      throw new Error(`Invalid backend configuration:\n  - FRONTEND_URL: not a valid URL (e.g. https://randroute-two.vercel.app)`);
    }
    env.FRONTEND_ORIGIN ??= origin;
    env.AUTH_REDIRECT_URL ??= `${origin}/auth/callback`;
  }
  return env;
}

/** The site's stable public address on Vercel (not the per-deployment URL, which changes every deploy). */
const vercelSiteUrl = (env: NodeJS.ProcessEnv): string | undefined => {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
};

const resolveFrontendOrigins = (env: NodeJS.ProcessEnv): string[] => {
  const explicit = env.FRONTEND_ORIGIN;
  if (explicit) return explicit.split(",").map((origin) => origin.trim()).filter(Boolean);
  const site = vercelSiteUrl(env);
  return site ? [site] : ["http://localhost:4173"];
};

const resolveAuthRedirectUrl = (env: NodeJS.ProcessEnv): string => {
  if (env.AUTH_REDIRECT_URL) return env.AUTH_REDIRECT_URL;
  const site = vercelSiteUrl(env);
  return site ? `${site}/auth/callback` : "http://localhost:4173/auth/callback";
};

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FRONTEND_ORIGIN: z.string().optional(),

  SUPABASE_URL: z.url({ error: "missing or invalid — use your project URL, e.g. https://xyz.supabase.co" }),
  SUPABASE_PUBLISHABLE_KEY: z.string({ error: "missing — copy the publishable (anon) key from Supabase. SUPABASE_ANON_KEY also works" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  SUPABASE_SECRET_KEY: z.string({ error: "missing — copy the secret (service_role) key from Supabase. SUPABASE_SERVICE_ROLE_KEY also works" }).min(1, { error: "empty — fill it in backend/.env", abort: true }).min(20, "looks too short"),
  SUPABASE_JWKS_URL: z.url().optional(),
  AUTH_REDIRECT_URL: z.string().optional(),

  // Refresh-token cookie. Defaults: Secure in production; SameSite=Lax (use "none" only
  // when the frontend and backend are on different sites, which also requires Secure).
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),

  AI_ENABLED: booleanString,
  GEMINI_API_KEY: z.string().optional().transform((value) => (value ? value : undefined)),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  // Tried automatically if the main model is busy, times out or is retired. Empty = no backup.
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash"),
  // Used for "Explain my spending", which streams the model's thinking. Must support thought summaries.
  GEMINI_THINKING_MODEL: z.string().default("gemini-3.5-flash"),
  VERCEL_URL: z.string().optional(),
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
    geminiFallbackModel?: string;
    geminiThinkingModel?: string;
  };
};

/** Reads and validates environment variables. Throws a readable error listing what is missing. */
export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = normaliseEnv(rawEnv);
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

  const frontendOrigins = resolveFrontendOrigins(env);
  const authRedirectUrl = resolveAuthRedirectUrl(env);

  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    frontendOrigins,
    supabase: {
      url: e.SUPABASE_URL,
      publishableKey: e.SUPABASE_PUBLISHABLE_KEY,
      secretKey: e.SUPABASE_SECRET_KEY,
      jwksUrl: e.SUPABASE_JWKS_URL,
      authRedirectUrl,
    },
    cookies: {
      secure: cookieSecure,
      sameSite: e.COOKIE_SAMESITE,
    },
    ai: {
      enabled: e.AI_ENABLED,
      geminiApiKey: e.GEMINI_API_KEY,
      geminiModel: e.GEMINI_MODEL,
      geminiFallbackModel: e.GEMINI_FALLBACK_MODEL && e.GEMINI_FALLBACK_MODEL !== e.GEMINI_MODEL ? e.GEMINI_FALLBACK_MODEL : undefined,
      geminiThinkingModel: e.GEMINI_THINKING_MODEL || undefined,
    },
  };
}
