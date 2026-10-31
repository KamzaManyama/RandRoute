import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "./config/env.js";
import type { SupabaseClients } from "./lib/supabase.js";
import type { GeminiService } from "./lib/gemini.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { healthRouter } from "./routes/health.js";
import { authRouter, CLIENT_HEADER } from "./routes/auth.js";
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

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.frontendOrigins,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", CLIENT_HEADER],
      credentials: true, // allows the httpOnly refresh cookie
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }),
  );

  app.use("/api/health", healthRouter(supabase, gemini));
  app.use("/api/auth", authRouter({ config, supabase }));
  app.use("/api/dashboard", dashboardRouter(supabase));
  app.use("/api/statements", statementsRouter(supabase));
  app.use("/api/categories", categoriesRouter(supabase));
  app.use("/api", spendingRouter(supabase)); // /spending/summary, /transactions, /sources
  app.use("/api/budgets", budgetsRouter(supabase));
  app.use("/api/profile", profileRouter({ config, supabase }));
  app.use("/api", insightsRouter({ config, supabase, gemini })); // /insights, /coach, /coach/preview, /budget-suggestions

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
