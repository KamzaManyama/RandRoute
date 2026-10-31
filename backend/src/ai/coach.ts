/**
 * AI coach: turns the app's calculated monthly figures into a plain-language
 * summary, 3 positives, 3 concerns, 3 actions and one motivating line.
 *
 * Safety layers, in order:
 *   1. Input is the strict CoachInput summary only (coachInput.ts).
 *   2. The model must answer in a fixed JSON shape.
 *   3. The answer is validated; every amount and percentage must be one we
 *      sent (grounding.ts); off-limits advice is dropped.
 *   4. If the summary itself can't be verified we ask once more, then give up
 *      rather than show unverified numbers.
 */
import { z } from "zod";
import type { GeminiService } from "../lib/gemini.js";
import { AiUnavailableError } from "../lib/gemini.js";
import type { CoachInput } from "./coachInput.js";
import { allowedNumbers, checkGrounding, isOffLimits } from "./grounding.js";

export const COACH_SYSTEM_PROMPT = `You are the RandRoute money coach. You explain someone's own monthly spending to them. They live in South Africa.
Rules:
- Use ONLY the figures in the DATA block. The app calculated them from the user's own imported bank statements. Never invent, estimate, add up or recalculate amounts or percentages. Quote figures exactly as written in DATA (e.g. R1 250.00).
- If coverage is "partial_month" or risk.provisional is true, say the month is incomplete.
- These are imported statements, not a live bank balance. Never call anything a current balance.
- Base every point on THEIR numbers: categories, budget status, changes, risk reasons, goals.
- General budgeting guidance only. No investment, credit, tax or legal advice. Never recommend specific products, banks or companies. Never promise outcomes.
- Plain, warm, simple English (about a Grade 8 reading level). Kind, never judgemental.`;

export const COACH_TASK = `Write this month's coaching as JSON with exactly these fields:
- summary: 2–3 sentences on money in vs money out, the savings rate and the biggest spending categories.
- positives: exactly 3 short points on what went well (e.g. a category that went down, budgets on track, a savings rate). If there is little good news, use small wins honestly.
- concerns: exactly 3 short points on the biggest issues (e.g. overspending, a category over budget, an unusual increase, high fees, unmarked income).
- actions: exactly 3 practical next steps for next month. Use the savingOpportunities figures where they fit (name the category and the saving exactly as given).
- motivation: one encouraging sentence with no numbers.
Each point is one sentence, under 30 words.`;

export const COACH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    positives: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    concerns: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    actions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    motivation: { type: "string" },
  },
  required: ["summary", "positives", "concerns", "actions", "motivation"],
} as const;

const point = z.string().trim().min(3).max(400);
const RawCoachSchema = z.object({
  summary: z.string().trim().min(10).max(1200),
  positives: z.array(point).min(1).max(5),
  concerns: z.array(point).min(1).max(5),
  actions: z.array(point).min(1).max(5),
  motivation: z.string().trim().min(3).max(300),
});

export type CoachAnswer = {
  summary: string;
  positives: string[];
  concerns: string[];
  actions: string[];
  motivation: string;
};

export type CoachVerification = {
  /** How many amounts and percentages were checked against the app's figures. */
  numbersChecked: number;
  /** Points dropped because they used figures we didn't send or broke the rules. */
  pointsRemoved: number;
  attempts: number;
};

export class CoachVerificationError extends Error {
  constructor() {
    super("The AI answer couldn't be checked against your figures, so we didn't show it.");
    this.name = "CoachVerificationError";
  }
}

/**
 * Validates and filters one raw model answer. Returns null when the answer
 * can't be used at all (bad shape, or the summary uses unverified numbers).
 */
export function validateCoachAnswer(raw: unknown, input: CoachInput): { answer: CoachAnswer; verification: Omit<CoachVerification, "attempts"> } | null {
  const parsed = RawCoachSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = allowedNumbers(input);
  let checked = 0;
  let removed = 0;

  const passes = (text: string) => {
    const result = checkGrounding(text, allowed);
    checked += result.checked;
    return result.ok && !isOffLimits(text);
  };
  const filter = (items: string[]) =>
    items.slice(0, 3).filter((item) => {
      const ok = passes(item);
      if (!ok) removed++;
      return ok;
    });

  if (!passes(parsed.data.summary)) return null;
  const motivation = passes(parsed.data.motivation) ? parsed.data.motivation : "Small, steady changes add up — you've got this.";
  const answer = {
    summary: parsed.data.summary,
    positives: filter(parsed.data.positives),
    concerns: filter(parsed.data.concerns),
    actions: filter(parsed.data.actions),
    motivation,
  };
  // Every section needs at least one usable point.
  if (!answer.positives.length || !answer.concerns.length || !answer.actions.length) return null;
  return { answer, verification: { numbersChecked: checked, pointsRemoved: removed } };
}

export async function runCoach(gemini: GeminiService, input: CoachInput): Promise<{ answer: CoachAnswer; verification: CoachVerification }> {
  const data = JSON.stringify(input, null, 2);
  const prompts = [
    `${COACH_TASK}\n\nDATA:\n${data}`,
    `${COACH_TASK}\nIMPORTANT: your last answer used figures that are not in DATA. Copy amounts and percentages exactly from DATA, or leave numbers out.\n\nDATA:\n${data}`,
  ];
  for (let attempt = 0; attempt < prompts.length; attempt++) {
    const raw = await gemini.generateJson(prompts[attempt]!, { system: COACH_SYSTEM_PROMPT, schema: COACH_RESPONSE_SCHEMA as unknown as Record<string, unknown> });
    const result = validateCoachAnswer(raw, input);
    if (result) return { answer: result.answer, verification: { ...result.verification, attempts: attempt + 1 } };
  }
  throw new CoachVerificationError();
}

// ---------------------------------------------------------------------------
// Budget plan review: same safety layers, smaller answer.
// ---------------------------------------------------------------------------

export const BUDGET_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    suggestions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
  },
  required: ["summary", "suggestions"],
} as const;

const RawBudgetSchema = z.object({ summary: z.string().trim().min(10).max(1200), suggestions: z.array(point).min(1).max(6) });

export type BudgetReview = { summary: string; suggestions: string[] };

export async function runBudgetReview(gemini: GeminiService, data: Record<string, unknown>): Promise<{ answer: BudgetReview; verification: CoachVerification }> {
  const task = `Review this draft monthly budget. Point out limits that look much lower or higher than the recent monthly average, and whether planned spending plus the savings target fits the expected income. Suggest adjustments in words; the user decides. Answer as JSON: summary (2 sentences) and suggestions (up to 5 one-sentence points).`;
  const allowed = allowedNumbers(data);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await gemini.generateJson(`${task}\n\nDATA:\n${JSON.stringify(data, null, 2)}`, {
      system: COACH_SYSTEM_PROMPT,
      schema: BUDGET_REVIEW_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = RawBudgetSchema.safeParse(raw);
    if (!parsed.success) continue;
    let checked = 0;
    let removed = 0;
    const ok = (text: string) => {
      const g = checkGrounding(text, allowed);
      checked += g.checked;
      return g.ok && !isOffLimits(text);
    };
    if (!ok(parsed.data.summary)) continue;
    const suggestions = parsed.data.suggestions.slice(0, 5).filter((s) => (ok(s) ? true : (removed++, false)));
    if (!suggestions.length) continue;
    return { answer: { summary: parsed.data.summary, suggestions }, verification: { numbersChecked: checked, pointsRemoved: removed, attempts: attempt } };
  }
  throw new CoachVerificationError();
}

export { AiUnavailableError };
