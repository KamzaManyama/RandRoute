import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { AiUnavailableError, type GeminiService } from "../lib/gemini.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { limiter, securityLog, WINDOWS } from "../middleware/security.js";
import { buildInsights } from "../finance/insights.js";
import { formatRand } from "../finance/health.js";
import { currentMonth, isMonth } from "../finance/rules.js";
import { buildCoachInput } from "../ai/coachInput.js";
import { CoachVerificationError, runBudgetReview, runCoach } from "../ai/coach.js";
import { AI_POLICY_VERSION } from "./profile.js";

/** SECURITY.md 10.4 — per-user AI limits, enforced from the ai_requests log so they hold across servers. */
export const AI_DAILY_LIMIT = 5;
export const AI_COOLDOWN_MS = 10 * 60 * 1000;
/** Outcomes that count as a used AI request. */
const COUNTED = ["ok", "failed", "refused"];
type AiKind = "coach" | "budget_suggestion";

const monthSchema = z.object({ month: z.string().refine(isMonth, "Choose a valid month.") });
const budgetSchema = z.object({
  month: z.string().refine(isMonth, "Choose a valid month."),
  plan: z.object({
    expectedIncomeMinor: z.number().int().min(0).nullable(),
    savingsTargetMinor: z.number().int().min(0).nullable(),
    limits: z
      .array(z.object({ name: z.string().max(60), limitMinor: z.number().int().min(0), averageMinor: z.number().int().min(0).nullable() }))
      .max(60),
  }),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

const r = (minor: number | null) => (minor === null ? "not set" : formatRand(minor));

export function insightsRouter({ config, supabase, gemini }: { config: AppConfig; supabase: SupabaseClients; gemini: GeminiService }): Router {
  const router = Router();
  const auth = requireAuth(supabase);
  const aiAvailable = () => config.ai.enabled && gemini.isEnabled;

  // SECURITY.md 10.4 — in-memory caps: 20 per IP and 100 for the whole service per 15 minutes.
  const aiIpLimit = limiter({ name: "ai_ip", windowMs: 15 * WINDOWS.MINUTE, limit: 20, by: "ip", message: "Too many AI requests from this network. Please wait 15 minutes." });
  const aiServiceLimit = limiter({ name: "ai_service", windowMs: 15 * WINDOWS.MINUTE, limit: 100, by: "global", message: "The AI coach is very busy right now. Please try again in a few minutes. Your figures still work." });
  const aiLimits = [aiIpLimit, aiServiceLimit];

  /**
   * AI must be on; the user must be set up, have agreed to the current
   * policy, and be within 5 requests a day and 1 every 10 minutes.
   */
  async function guardAi(req: Request, res: Response, kind: AiKind) {
    const db = req.auth!.db;
    if (!aiAvailable()) {
      throw new HttpError(503, "ai_unavailable", "AI coaching is switched off. Everything else still works.");
    }
    const { data: prefs, error } = await db
      .from("user_preferences")
      .select("ai_consent_status, ai_consent_policy_version, setup_completed_at")
      .maybeSingle();
    if (error) throw new HttpError(502, "database_error", "We couldn't check your AI settings.");
    if (!prefs?.setup_completed_at) {
      throw new HttpError(403, "setup_required", "Finish setting up your account before using the AI coach.");
    }
    if (prefs.ai_consent_status !== "granted" || prefs.ai_consent_policy_version !== AI_POLICY_VERSION) {
      throw new HttpError(403, "consent_required", "Please agree to how AI coaching works before using it.");
    }

    const now = Date.now();
    const { data: recent, error: logError } = await db
      .from("ai_requests")
      .select("created_at, status")
      .gte("created_at", new Date(now - WINDOWS.DAY).toISOString())
      .in("status", COUNTED)
      .order("created_at", { ascending: true });
    if (logError) throw new HttpError(502, "database_error", "We couldn't check your AI usage.");
    const used = ((recent ?? []) as { created_at?: string; status?: string }[]).filter((r) => !r.status || COUNTED.includes(r.status));
    const times = used.map((r) => (r.created_at ? Date.parse(r.created_at) : now)).filter(Number.isFinite);

    const block = async (code: string, message: string, retryAfterMs: number) => {
      await db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status: "quota_exceeded" });
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      securityLog("ai_limit", req, { limit: code });
      throw new HttpError(429, code, message);
    };
    if (used.length >= AI_DAILY_LIMIT) {
      const oldest = Math.min(...times, now);
      await block("ai_quota", `You've used today's ${AI_DAILY_LIMIT} AI answers. Try again tomorrow.`, oldest + WINDOWS.DAY - now);
    }
    // The 10-minute wait follows a successful answer; a failed attempt can be retried (it still counts for the day).
    const latest = Math.max(...used.filter((r) => !r.status || r.status === "ok").map((r) => (r.created_at ? Date.parse(r.created_at) : now)), 0);
    if (latest && now - latest < AI_COOLDOWN_MS) {
      const wait = AI_COOLDOWN_MS - (now - latest);
      await block("ai_cooldown", `You can ask the AI once every 10 minutes. Try again in ${Math.ceil(wait / 60000)} minute${wait > 60000 ? "s" : ""}.`, wait);
    }
  }

  /** Runs an AI call and logs the outcome (never the prompt or the answer). */
  async function withAiLog<T>(req: Request, kind: AiKind, run: () => Promise<T>): Promise<T> {
    const log = (status: string) => req.auth!.db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status });
    try {
      const result = await run();
      await log("ok");
      return result;
    } catch (error) {
      if (error instanceof CoachVerificationError) {
        await log("refused");
        throw new HttpError(502, "ai_unverified", `${error.message} Your figures are still accurate — try again in a minute.`);
      }
      await log("failed");
      const message = error instanceof AiUnavailableError ? error.message : "The AI service is unavailable right now.";
      throw new HttpError(503, "ai_unavailable", `${message} Your figures are still accurate.`);
    }
  }

  /** Calculated insights. Opening this never calls AI. */
  router.get("/insights", auth, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const insights = await buildInsights(req.auth!.db, month);
    res.json({ insights, ai: { available: aiAvailable() } });
  });

  /**
   * Exactly what the coach would send to Gemini for this month — shown to the
   * user before they press the button. No AI call.
   */
  router.get("/coach/preview", auth, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    res.json({ input: buildCoachInput(await buildInsights(req.auth!.db, month)), ai: { available: aiAvailable() } });
  });

  /** AI coach — only after the user presses the button. */
  router.post("/coach", ...aiLimits, auth, async (req, res) => {
    const { month } = parse(monthSchema, req.body);
    await guardAi(req, res, "coach");
    const insights = await buildInsights(req.auth!.db, month);
    if (!insights.coverage.hasImports) {
      throw new HttpError(409, "no_data", "Import a statement for this month before asking the coach.");
    }
    const input = buildCoachInput(insights);
    const { answer, verification } = await withAiLog(req, "coach", () => runCoach(gemini, input));
    res.json({ coach: answer, verification, basedOn: input, generatedAt: new Date().toISOString(), source: "ai_generated" });
  });

  /** Advisory review of a draft plan. Never saves anything. */
  router.post("/budget-suggestions", ...aiLimits, auth, async (req, res) => {
    const { month, plan } = parse(budgetSchema, req.body);
    await guardAi(req, res, "budget_suggestion");
    const planned = plan.limits.reduce((s, l) => s + l.limitMinor, 0);
    const data = {
      month,
      expectedIncome: r(plan.expectedIncomeMinor),
      savingsTarget: r(plan.savingsTargetMinor),
      totalPlanned: r(planned),
      plannedPlusSavings: r(planned + (plan.savingsTargetMinor ?? 0)),
      // Worked out here so the AI never has to subtract.
      leftOverAfterPlanAndSavings: plan.expectedIncomeMinor === null ? "not set" : r(plan.expectedIncomeMinor - planned - (plan.savingsTargetMinor ?? 0)),
      categories: plan.limits.map((l) => ({ category: l.name.slice(0, 60), limit: r(l.limitMinor), recentMonthlyAverage: r(l.averageMinor) })),
    };
    const { answer, verification } = await withAiLog(req, "budget_suggestion", () => runBudgetReview(gemini, data));
    res.json({ review: answer, verification, basedOn: data, generatedAt: new Date().toISOString(), source: "ai_generated" });
  });

  return router;
}
