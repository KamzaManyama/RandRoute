import { Router, type Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { AiUnavailableError, type GeminiService } from "../lib/gemini.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { buildInsights } from "../finance/insights.js";
import { formatRand } from "../finance/health.js";
import { currentMonth, isMonth } from "../finance/rules.js";
import { buildCoachInput } from "../ai/coachInput.js";
import { CoachVerificationError, runBudgetReview, runCoach } from "../ai/coach.js";
import { AI_POLICY_VERSION } from "./profile.js";

const AI_DAILY_LIMIT = 20;
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

  /** AI must be on, the user must have agreed to the current policy, and be under the daily limit. */
  async function guardAi(req: Request, kind: AiKind) {
    const db = req.auth!.db;
    if (!aiAvailable()) {
      throw new HttpError(503, "ai_unavailable", "AI coaching is switched off. Everything else still works.");
    }
    const { data: prefs, error } = await db.from("user_preferences").select("ai_consent_status, ai_consent_policy_version").maybeSingle();
    if (error) throw new HttpError(502, "database_error", "We couldn't check your AI settings.");
    if (prefs?.ai_consent_status !== "granted" || prefs.ai_consent_policy_version !== AI_POLICY_VERSION) {
      throw new HttpError(403, "consent_required", "Please agree to how AI coaching works before using it.");
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await db.from("ai_requests").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= AI_DAILY_LIMIT) {
      await db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status: "quota_exceeded" });
      throw new HttpError(429, "ai_quota", `You've used today's ${AI_DAILY_LIMIT} AI answers. Try again tomorrow.`);
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
  router.post("/coach", auth, async (req, res) => {
    const { month } = parse(monthSchema, req.body);
    await guardAi(req, "coach");
    const insights = await buildInsights(req.auth!.db, month);
    if (!insights.coverage.hasImports) {
      throw new HttpError(409, "no_data", "Import a statement for this month before asking the coach.");
    }
    const input = buildCoachInput(insights);
    const { answer, verification } = await withAiLog(req, "coach", () => runCoach(gemini, input));
    res.json({ coach: answer, verification, basedOn: input, generatedAt: new Date().toISOString(), source: "ai_generated" });
  });

  /** Advisory review of a draft plan. Never saves anything. */
  router.post("/budget-suggestions", auth, async (req, res) => {
    const { month, plan } = parse(budgetSchema, req.body);
    await guardAi(req, "budget_suggestion");
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
