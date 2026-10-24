import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "./config/env.js";
import type { SupabaseClients } from "./lib/supabase.js";
import type { GeminiService } from "./lib/gemini.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { healthRouter } from "./routes/health.js";

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
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    "/api",
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }),
  );

  app.use("/api/health", healthRouter(supabase, gemini));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
