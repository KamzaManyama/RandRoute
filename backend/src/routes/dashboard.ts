import { Router } from "express";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { fetchImports, fetchTransactions } from "../finance/queries.js";
import { categoryNameOf, coverageFor, currentMonth, isMonth, monthRange, summarise } from "../finance/rules.js";

export function dashboardRouter(supabase: SupabaseClients): Router {
  const router = Router();

  /** Screen 04 — Home: totals for one month. */
  router.get("/summary", requireAuth(supabase), async (req, res) => {
    const db = req.auth!.db;
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const { start, end } = monthRange(month);

    const { data: prefs, error: prefsError } = await db
      .from("user_preferences")
      .select("monthly_budget_target_minor")
      .maybeSingle();
    if (prefsError) throw new HttpError(502, "dashboard_unavailable", "We couldn't load your dashboard.");

    const [rows, imports] = await Promise.all([fetchTransactions(db, { start, end }), fetchImports(db)]);
    const totals = summarise(rows);
    const budgetTarget = (prefs?.monthly_budget_target_minor as number | null | undefined) ?? null;

    res.json({
      month,
      moneyIn: totals.moneyIn,
      moneyOut: totals.moneyOut,
      netCashFlow: totals.netCashFlow,
      refunds: totals.refunds,
      unclassifiedIn: totals.unclassifiedIn,
      budgetTarget,
      budgetRemaining: budgetTarget === null ? null : budgetTarget - totals.moneyOut,
      topCategories: totals.categories.slice(0, 5),
      recentTransactions: rows.slice(0, 5).map((row) => ({
        id: row.id,
        date: row.transaction_date,
        description: row.cleaned_description,
        amountMinor: Number(row.amount_minor),
        direction: row.direction,
        transactionType: row.transaction_type,
        categoryName: categoryNameOf(row),
      })),
      coverage: coverageFor(month, imports),
    });
  });

  return router;
}
