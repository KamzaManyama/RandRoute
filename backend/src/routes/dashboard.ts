import { Router } from "express";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { buildInsights } from "../finance/insights.js";
import { categoryNameOf, currentMonth, isMonth, monthRange, type FinanceRow } from "../finance/rules.js";
import { CHANNEL_LABELS, type Channel } from "../statements/channel.js";

export function dashboardRouter(supabase: SupabaseClients): Router {
  const router = Router();

  /**
   * Home: one month's figures. Uses the same calculation as Insights and the
   * AI coach, so every screen shows the same numbers.
   */
  router.get("/summary", requireAuth(supabase), async (req, res) => {
    const db = req.auth!.db;
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const { start, end } = monthRange(month);

    const [insights, prefs, recent] = await Promise.all([
      buildInsights(db, month),
      db.from("user_preferences").select("monthly_budget_target_minor").maybeSingle(),
      db
        .from("transactions")
        .select("id, transaction_date, cleaned_description, amount_minor, direction, transaction_type, excluded_from_totals, channel, categories(name)")
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
    if (prefs.error || recent.error) throw new HttpError(502, "dashboard_unavailable", "We couldn't load your dashboard.");

    const t = insights.totals;
    const budgetTarget = (prefs.data?.monthly_budget_target_minor as number | null | undefined) ?? null;

    res.json({
      month,
      moneyIn: t.moneyInMinor,
      moneyOut: t.moneyOutMinor,
      netCashFlow: t.netMinor,
      refunds: t.refundsMinor,
      unclassifiedIn: t.unclassifiedInMinor,
      transfers: t.transfersMinor,
      income: t.income, // { salary, side, other } in cents
      debitOrders: t.debitOrders,
      savingsRate: insights.savingsRate,
      health: insights.health,
      goals: insights.goals,
      budgetTarget: budgetTarget === null ? null : Number(budgetTarget),
      budgetRemaining: budgetTarget === null ? null : Number(budgetTarget) - t.moneyOutMinor,
      budget: { hasBudget: insights.budget.hasBudget, overCount: insights.budget.overCount },
      topCategories: insights.topCategories.map((c) => ({ categoryId: c.categoryId, name: c.name, total: c.totalMinor, count: c.count, sharePercent: c.sharePercent })),
      recentTransactions: (recent.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        date: row.transaction_date as string,
        description: row.cleaned_description as string,
        amountMinor: Number(row.amount_minor),
        direction: row.direction as "inflow" | "outflow",
        transactionType: row.transaction_type as string,
        channelLabel: CHANNEL_LABELS[(row.channel ?? "unknown") as Channel] ?? "Other",
        categoryName: categoryNameOf(row as unknown as FinanceRow),
      })),
      coverage: insights.coverage,
      limitations: insights.limitations,
    });
  });

  return router;
}
