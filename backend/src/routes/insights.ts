import { Router, type Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { AiUnavailableError, type GeminiService } from "../lib/gemini.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { aiContext, buildInsights } from "../finance/insights.js";
import { currentMonth, isMonth } from "../finance/rules.js";
import { AI_POLICY_VERSION } from "./profile.js";

const AI_DAILY_LIMIT = 20;

/**
 * Rules every AI answer follows. People can't type questions — the AI only
 * explains the person's own spending figures, so there's no free text to misuse.
 */
const SYSTEM_PROMPT = `You are the RandRoute assistant, explaining someone's own spending to them. They live in South Africa.
Rules:
- Use ONLY the figures in the DATA block. They were calculated by the app from the user's imported bank statements. Never invent, estimate or recalculate totals; you may compare two figures that are both given.
- Amounts are South African rand. Write them like R1 250.00.
- Mention the limitations listed in the data when they affect what you say (e.g. partial months).
- These are imported statements, not a live bank balance — never call anything a current balance.
- Improvement ideas must come from THEIR categories and numbers (e.g. a category that grew, went over budget, or is a large share). Keep them practical and kind; no judgement.
- General budgeting guidance only. No investment, credit, tax or legal advice. Never promise outcomes. Don't recommend specific products or companies.
- Plain, warm, simple English that anyone can follow.`;

/** What a spending explanation must cover, in this order. */
const EXPLAIN_TASK = `Explain this month's spending using exactly these four sections. Put each heading on its own line, followed by bullets:
Where your money went
- 2–3 bullets on the biggest categories and money in vs money out.
What changed
- 1–3 bullets on changes from last month, unusual spending or budget limits. If there's nothing to compare, say why in one bullet.
How you could save
- 3–4 specific ideas using savingOpportunities: name the category, a realistic step (e.g. cooking at home twice more a week, pausing one subscription) and the saving per month and per year exactly as given in the data. Mention any category that went over budget and by how much.
Smart money habits
- 2–3 short, general habits that fit their situation (e.g. paying yourself first on payday, a weekly spending check-in, an emergency fund). No products or companies.
Keep the whole answer under 330 words. No other headings, no introduction, no sign-off.`;

const explainSchema = z.object({ month: z.string().refine(isMonth, "Choose a valid month.") });
const budgetSchema = z.object({
  month: z.string().refine(isMonth, "Choose a valid month."),
  plan: z.object({
    expectedIncomeMinor: z.number().int().min(0).nullable(),
    savingsTargetMinor: z.number().int().min(0).nullable(),
    limits: z.array(z.object({ name: z.string().max(60), limitMinor: z.number().int().min(0), averageMinor: z.number().int().min(0).nullable() })).max(60),
  }),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

const r = (minor: number | null) => (minor === null ? "not set" : `R${(minor / 100).toFixed(2)}`);

export function insightsRouter({ config, supabase, gemini }: { config: AppConfig; supabase: SupabaseClients; gemini: GeminiService }): Router {
  const router = Router();
  const auth = requireAuth(supabase);

  /** Checks AI is on, the user consented to the current policy, and is under the daily limit. */
  async function guardAi(req: Request, kind: "explain_insight" | "budget_suggestion") {
    const db = req.auth!.db;
    if (!config.ai.enabled || !gemini.isEnabled) {
      throw new HttpError(503, "ai_unavailable", "AI explanations are switched off. Everything else still works.");
    }
    const { data: prefs, error } = await db
      .from("user_preferences")
      .select("ai_consent_status, ai_consent_policy_version")
      .maybeSingle();
    if (error) throw new HttpError(502, "database_error", "We couldn't check your AI settings.");
    if (prefs?.ai_consent_status !== "granted" || prefs.ai_consent_policy_version !== AI_POLICY_VERSION) {
      throw new HttpError(403, "consent_required", "Please agree to how AI explanations work before using them.");
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await db.from("ai_requests").select("id", { count: "exact", head: true }).gte("created_at", since);
    if ((count ?? 0) >= AI_DAILY_LIMIT) {
      await db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status: "quota_exceeded" });
      throw new HttpError(429, "ai_quota", `You've used today's ${AI_DAILY_LIMIT} AI answers. Try again tomorrow.`);
    }
  }

  /** Calls Gemini and logs the request (no prompt or answer is stored). */
  async function runAi(req: Request, kind: "explain_insight" | "budget_suggestion", prompt: string) {
    try {
      const text = await gemini.generateText(prompt, { system: SYSTEM_PROMPT });
      await req.auth!.db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status: "ok" });
      return text;
    } catch (error) {
      await req.auth!.db.from("ai_requests").insert({ user_id: req.auth!.userId, kind, status: "failed" });
      const message = error instanceof AiUnavailableError ? error.message : "The AI service is unavailable right now.";
      throw new HttpError(503, "ai_unavailable", `${message} Your figures are still accurate.`);
    }
  }

  /** Screen 14 — calculated insights. Opening this never calls AI. */
  router.get("/insights", auth, async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const insights = await buildInsights(req.auth!.db, month);
    res.json({ insights, ai: { available: config.ai.enabled && gemini.isEnabled } });
  });

  /** Explain this month — only after the user presses the button. */
  router.post("/insights/explain", auth, async (req, res) => {
    const { month } = parse(explainSchema, req.body);
    await guardAi(req, "explain_insight");
    const context = aiContext(await buildInsights(req.auth!.db, month));
    const text = await runAi(
      req,
      "explain_insight",
      `${EXPLAIN_TASK}\n\nDATA:\n${JSON.stringify(context, null, 2)}`,
    );
    res.json({ text, basedOn: context, generatedAt: new Date().toISOString() });
  });

  /**
   * Explain my spending, streamed (Server-Sent Events) so the page can show
   * each step, the AI's thinking, and the answer as it's written.
   * Events: step {id,label,state} · thought {text} · text {text} · done {generatedAt} · error {message}
   */
  router.post("/insights/explain/stream", auth, async (req, res) => {
    const { month } = parse(explainSchema, req.body);
    await guardAi(req, "explain_insight"); // errors here are normal JSON responses

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const controller = new AbortController();
    res.on("close", () => controller.abort()); // the user left the page
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send("step", { id: "figures", label: "Calculating your figures", state: "active" });
      const context = aiContext(await buildInsights(req.auth!.db, month));
      send("step", { id: "figures", label: "Calculated your totals, changes and saving opportunities", state: "done" });
      send("step", { id: "share", label: "Sharing category totals only — no descriptions, account numbers or personal details", state: "done" });
      send("step", { id: "ai", label: "AI is reading your figures", state: "active" });

      let thinkingShown = false;
      let writingShown = false;
      await gemini.streamText(`${EXPLAIN_TASK}\n\nDATA:\n${JSON.stringify(context, null, 2)}`, {
        system: SYSTEM_PROMPT,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "thought" && !thinkingShown) {
            thinkingShown = true;
            send("step", { id: "ai", label: "AI is thinking it through", state: "active" });
          }
          if (event.type === "text" && !writingShown) {
            writingShown = true;
            send("step", { id: "ai", label: thinkingShown ? "AI finished thinking" : "AI read your figures", state: "done" });
            send("step", { id: "write", label: "Writing your explanation", state: "active" });
          }
          send(event.type, { text: event.text });
        },
      });
      send("step", { id: "write", label: "Explanation ready", state: "done" });
      await req.auth!.db.from("ai_requests").insert({ user_id: req.auth!.userId, kind: "explain_insight", status: "ok" });
      send("done", { generatedAt: new Date().toISOString() });
    } catch (error) {
      await req.auth!.db.from("ai_requests").insert({ user_id: req.auth!.userId, kind: "explain_insight", status: "failed" });
      const message = error instanceof AiUnavailableError ? error.message : "The AI service is unavailable right now.";
      send("error", { message: `${message} Your figures are still accurate — try again in a minute.` });
    } finally {
      res.end();
    }
  });

  /** Screen 13 — advisory suggestions on a draft plan. Never saves anything. */
  router.post("/budget-suggestions", auth, async (req, res) => {
    const { month, plan } = parse(budgetSchema, req.body);
    await guardAi(req, "budget_suggestion");
    const planned = plan.limits.reduce((s, l) => s + l.limitMinor, 0);
    const context = {
      month,
      expectedIncome: r(plan.expectedIncomeMinor),
      savingsTarget: r(plan.savingsTargetMinor),
      totalPlanned: r(planned),
      plannedPlusSavings: r(planned + (plan.savingsTargetMinor ?? 0)),
      categories: plan.limits.map((l) => ({ category: l.name, limit: r(l.limitMinor), recentMonthlyAverage: r(l.averageMinor) })),
    };
    const text = await runAi(
      req,
      "budget_suggestion",
      `Review this draft monthly budget. Point out limits that look much lower or higher than the recent average, and whether the plan plus savings fits the expected income. Suggest adjustments in words; the user decides.\n\nDATA:\n${JSON.stringify(context, null, 2)}`,
    );
    res.json({ text, basedOn: context, generatedAt: new Date().toISOString() });
  });

  return router;
}
