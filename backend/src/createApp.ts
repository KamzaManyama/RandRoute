import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { AppConfig } from "./config/env.js";
import type { SupabaseClients } from "./lib/supabase.js";
import type { GeminiService } from "./lib/gemini.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { sessionCookies } from "./lib/sessionCookies.js";
import { readSessionCookie } from "./middleware/requireAuth.js";
import { CLIENT_HEADER, CSRF_HEADER, limiter, requestId, requireClientHeader, requireCsrf, sameOriginOnly, WINDOWS } from "./middleware/security.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { categoriesRouter, statementsRouter } from "./routes/statements.js";
import { spendingRouter } from "./routes/spending.js";
import { budgetsRouter } from "./routes/budgets.js";
import { profileRouter } from "./routes/profile.js";
import { insightsRouter } from "./routes/insights.js";

export type AppDeps = {
  config: AppConfig;
  supabase: SupabaseClients;
  gemini: GeminiService;
};

/** Builds the Express app. Dependencies are passed in so tests can use fakes. */
export function createApp({ config, supabase, gemini }: AppDeps): Express {
  const app = express();
  const cookies = sessionCookies(config);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestId);

  // Security headers (SECURITY.md 11.2). The API only returns JSON and files.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
      crossOriginResourcePolicy: { policy: "same-origin" },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
    next();
  });

  // Trusted origins only; cookies are allowed for those origins (SECURITY.md 11.1).
  app.use(
    cors({
      origin: config.frontendOrigins,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", CLIENT_HEADER, CSRF_HEADER],
      exposedHeaders: ["Retry-After", "X-Request-Id"],
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Financial data must never be cached by the browser or a proxy.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // General limit: 120 requests per minute per IP (SECURITY.md 15.1).
  app.use("/api", limiter({ name: "api", windowMs: WINDOWS.MINUTE, limit: 120, by: "ip" }));

  // CSRF defence in depth (SECURITY.md 7): trusted Origin, app-only header, CSRF token.
  app.use("/api", sameOriginOnly(config.frontendOrigins));
  const isHealthCheck = (req: express.Request) => req.method === "GET" && req.path.startsWith("/health");
  app.use("/api", (req, res, next) => (isHealthCheck(req) ? next() : requireClientHeader(req, res, next)));
  app.use("/api", requireCsrf(cookies.names.csrf));

  // Session comes only from the HttpOnly cookie.
  app.use("/api", readSessionCookie(cookies));

  app.use("/api/health", healthRouter(supabase, gemini));
  app.use("/api/auth", authRouter({ config, supabase, cookies }));
  app.use("/api/dashboard", dashboardRouter(supabase));
  app.use("/api/statements", statementsRouter(supabase));
  app.use("/api/categories", categoriesRouter(supabase));
  app.use("/api", spendingRouter(supabase)); // /spending/summary, /transactions, /sources
  app.use("/api/budgets", budgetsRouter(supabase));
  app.use("/api/profile", profileRouter({ config, supabase, cookies }));
  app.use("/api", insightsRouter({ config, supabase, gemini })); // /insights, /coach, /coach/preview, /budget-suggestions

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
