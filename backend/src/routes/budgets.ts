import { Router } from "express";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { fetchImports, fetchTransactions } from "../finance/queries.js";
import { coverageFor, isMonth, limitStatus, monthRange, shiftMonth, summarise } from "../finance/rules.js";

const MAX_MINOR = 100_000_000_000;
const minor = (label: string) =>
  z
    .number({ error: `Enter ${label}.` })
    .int(`Enter ${label} in cents.`)
    .min(0, `${label[0]!.toUpperCase()}${label.slice(1)} can't be negative.`)
    .max(MAX_MINOR, "That amount is too large.");

const saveSchema = z.object({
  expectedIncomeMinor: minor("expected income").nullable(),
  savingsTargetMinor: minor("a savings target").nullable(),
  limits: z
    .array(z.object({ categoryId: z.uuid("Choose a category."), limitMinor: minor("a limit") }))
    .max(60, "That's too many categories.")
    .refine((l) => new Set(l.map((x) => x.categoryId)).size === l.length, "Each category can only appear once."),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

const dbError = (what: string) => new HttpError(502, "database_error", `We couldn't ${what}. Please try again.`);

function monthParam(value: unknown): string {
  if (!isMonth(value)) throw new HttpError(400, "validation_error", "Choose a valid month.");
  return value;
}

async function loadBudget(db: SupabaseClient, month: string) {
  const { data, error } = await db
    .from("monthly_budgets")
    .select("id, month, expected_income_minor, savings_target_minor, budget_category_limits(category_id, limit_minor, categories(name))")
    .eq("month", `${month}-01`)
    .maybeSingle();
  if (error) throw dbError("load your budget");
  return data as null | {
    id: string;
    expected_income_minor: number | null;
    savings_target_minor: number | null;
    budget_category_limits: { category_id: string; limit_minor: number; categories: { name: string } | { name: string }[] | null }[];
  };
}

export function budgetsRouter(supabase: SupabaseClients): Router {
  const router = Router();
  router.use(requireAuth(supabase));

  /** Screen 12 — a month's plan compared with qualifying spending. */
  router.get("/:month", async (req, res) => {
    const db = req.auth!.db;
    const month = monthParam(req.params.month);
    const historyStart = shiftMonth(month, -3);

    const [budget, previousBudget, rows, imports] = await Promise.all([
      loadBudget(db, month),
      loadBudget(db, shiftMonth(month, -1)),
      fetchTransactions(db, { start: monthRange(historyStart).start, end: monthRange(month).end }),
      fetchImports(db),
    ]);

    const thisMonth = rows.filter((r) => r.transaction_date.startsWith(month));
    const totals = summarise(thisMonth);
    const spentBy = new Map(totals.categories.map((c) => [c.categoryId ?? "none", c]));

    const limits = (budget?.budget_category_limits ?? [])
      .map((l) => {
        const spent = spentBy.get(l.category_id)?.total ?? 0;
        const cat = Array.isArray(l.categories) ? l.categories[0] : l.categories;
        return {
          categoryId: l.category_id,
          name: cat?.name ?? "Category",
          limitMinor: Number(l.limit_minor),
          spentMinor: spent,
          remainingMinor: Number(l.limit_minor) - spent,
          status: limitStatus(Number(l.limit_minor), spent),
        };
      })
      .sort((a, b) => b.limitMinor - a.limitMinor);

    const budgeted = new Set(limits.map((l) => l.categoryId));
    const unbudgeted = totals.categories
      .filter((c) => !budgeted.has(c.categoryId ?? "none"))
      .map((c) => ({ categoryId: c.categoryId, name: c.name, spentMinor: c.total }));

    // Averages from the last 3 fully covered months — used to suggest limits.
    const historyMonths = [1, 2, 3].map((i) => shiftMonth(month, -i)).filter((m) => coverageFor(m, imports).coversWholeMonth);
    const sums = new Map<string, { categoryId: string | null; name: string; total: number }>();
    for (const m of historyMonths) {
      for (const c of summarise(rows.filter((r) => r.transaction_date.startsWith(m))).categories) {
        const key = c.categoryId ?? "none";
        const entry = sums.get(key) ?? { categoryId: c.categoryId, name: c.name, total: 0 };
        entry.total += c.total;
        sums.set(key, entry);
      }
    }
    const averages = [...sums.values()]
      .filter((s) => s.categoryId)
      .map((s) => ({ categoryId: s.categoryId!, name: s.name, averageMinor: Math.round(s.total / historyMonths.length) }))
      .sort((a, b) => b.averageMinor - a.averageMinor);

    const planned = limits.reduce((sum, l) => sum + l.limitMinor, 0);
    const spentInBudget = limits.reduce((sum, l) => sum + l.spentMinor, 0);

    res.json({
      month,
      budget: budget
        ? {
            id: budget.id,
            expectedIncomeMinor: budget.expected_income_minor === null ? null : Number(budget.expected_income_minor),
            savingsTargetMinor: budget.savings_target_minor === null ? null : Number(budget.savings_target_minor),
          }
        : null,
      limits,
      unbudgeted,
      totals: {
        plannedMinor: planned,
        spentInBudgetMinor: spentInBudget,
        remainingMinor: planned - spentInBudget,
        totalSpendingMinor: totals.moneyOut,
        refundsMinor: totals.refunds,
      },
      coverage: coverageFor(month, imports),
      previousMonthHasBudget: Boolean(previousBudget?.budget_category_limits.length),
      history: { months: historyMonths.length, averages },
    });
  });

  /** Screen 13 — save the whole plan for a month (atomic). */
  router.put("/:month", async (req, res) => {
    const month = monthParam(req.params.month);
    const body = parse(saveSchema, req.body);
    const { data, error } = await req.auth!.db.rpc("save_budget", {
      p_month: `${month}-01`,
      p_expected_income_minor: body.expectedIncomeMinor,
      p_savings_target_minor: body.savingsTargetMinor,
      p_limits: body.limits.map((l) => ({ category_id: l.categoryId, limit_minor: l.limitMinor })),
    });
    if (error) {
      if (error.code === "42501" || error.code === "23503") {
        throw new HttpError(400, "validation_error", "One of the categories can't be used.", { limits: "Choose categories from the list." });
      }
      if (error.code === "PGRST202") {
        throw new HttpError(503, "migration_missing", "Budgets need the latest database update (SQL migration 6).");
      }
      throw dbError("save your budget");
    }
    res.json({ budgetId: data as string });
  });

  /** Copy last month's plan into this month (only if this month has none). */
  router.post("/:month/copy-previous", async (req, res) => {
    const db = req.auth!.db;
    const month = monthParam(req.params.month);
    const [current, previous] = await Promise.all([loadBudget(db, month), loadBudget(db, shiftMonth(month, -1))]);
    if (current?.budget_category_limits.length) {
      throw new HttpError(409, "budget_exists", "This month already has a budget. Edit it instead.");
    }
    if (!previous?.budget_category_limits.length) {
      throw new HttpError(404, "no_previous_budget", "Last month has no budget to copy.");
    }
    const { error } = await db.rpc("save_budget", {
      p_month: `${month}-01`,
      p_expected_income_minor: previous.expected_income_minor,
      p_savings_target_minor: previous.savings_target_minor,
      p_limits: previous.budget_category_limits.map((l) => ({ category_id: l.category_id, limit_minor: l.limit_minor })),
    });
    if (error) throw dbError("copy last month's budget");
    res.status(201).json({ copied: previous.budget_category_limits.length });
  });

  /** Remove a month's plan (spending is untouched). */
  router.delete("/:month", async (req, res) => {
    const month = monthParam(req.params.month);
    const { error } = await req.auth!.db.from("monthly_budgets").delete().eq("month", `${month}-01`);
    if (error) throw dbError("remove this budget");
    res.status(204).end();
  });

  return router;
}

