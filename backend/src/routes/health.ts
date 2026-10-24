import { Router } from "express";
import type { SupabaseClients } from "../lib/supabase.js";
import type { GeminiService } from "../lib/gemini.js";

export function healthRouter(supabase: SupabaseClients, gemini: GeminiService): Router {
  const router = Router();

  /** Liveness: the server is up. */
  router.get("/", (_req, res) => {
    res.json({ status: "ok", ai: gemini.isEnabled ? "enabled" : "disabled" });
  });

  /**
   * Setup check: can we reach Supabase, and have the migrations been run?
   * Counts the seeded system categories (no user data involved).
   */
  router.get("/db", async (_req, res) => {
    const { count, error } = await supabase.admin
      .from("categories")
      .select("id", { count: "exact", head: true })
      .is("user_id", null);

    if (error) {
      res.status(503).json({
        database: "unavailable",
        hint: "Check SUPABASE_URL / keys and that the SQL in supabase/migrations has been run.",
      });
      return;
    }
    res.json({ database: "ok", systemCategories: count ?? 0 });
  });

  return router;
}
