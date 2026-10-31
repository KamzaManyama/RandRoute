/**
 * Screen 14 — monthly insights, all calculated by the app (never by AI).
 * The same object is the only thing an AI explanation is allowed to see.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchImports, fetchTransactions } from "./queries.js";
import { coverageFor, limitStatus, monthRange, shiftMonth, summarise, type Coverage } from "./rules.js";
import { assessHealth, bpToPercent, savingsRateBp } from "./health.js";

const HISTORY_MONTHS = 6;
/** A rise must be at least this much (cents) AND 30% above average to be called unusual. */
const UNUSUAL_MIN_MINOR = 20_000;
const UNUSUAL_FACTOR = 1.3;
const MIN_HISTORY_FOR_UNUSUAL = 3;

export type MonthInsights = Awaited<ReturnType<typeof buildInsights>>;

export async function buildInsights(db: SupabaseClient, month: string) {
  const start = monthRange(shiftMonth(month, -HISTORY_MONTHS)).start;
  const [rows, imports, budget, prefs] = await Promise.all([
    fetchTransactions(db, { start, end: monthRange(month).end }),
    fetchImports(db),
    db
      .from("monthly_budgets")
      .select("expected_income_minor, savings_target_minor, budget_category_limits(category_id, limit_minor, categories(name))")
      .eq("month", `${month}-01`)
      .maybeSingle(),
    db
      .from("user_preferences")
      .select("monthly_budget_target_minor, savings_target_minor, expected_monthly_income_minor")
      .maybeSingle(),
  ]);

  const rowsFor = (m: string) => rows.filter((r) => r.transaction_date.startsWith(m));
  const current = summarise(rowsFor(month));
  const coverage: Coverage = coverageFor(month, imports);
  const previousMonth = shiftMonth(month, -1);
  const previous = summarise(rowsFor(previousMonth));
  const previousCoverage = coverageFor(previousMonth, imports);

  const comparable = coverage.coversWholeMonth && previousCoverage.coversWholeMonth;
  const comparison = {
    month: previousMonth,
    available: comparable,
    reason: comparable
      ? null
      : !coverage.coversWholeMonth
        ? "This month isn't fully covered by your statements."
        : "Last month isn't fully covered by your statements.",
  };

  const previousBy = new Map(previous.categories.map((c) => [c.categoryId ?? "none", c.total]));
  const changes = comparable
    ? [...new Set([...current.categories.map((c) => c.categoryId ?? "none"), ...previousBy.keys()])]
        .map((key) => {
          const now = current.categories.find((c) => (c.categoryId ?? "none") === key);
          const before = previousBy.get(key) ?? 0;
          const name = now?.name ?? previous.categories.find((c) => (c.categoryId ?? "none") === key)?.name ?? "Uncategorised";
          const total = now?.total ?? 0;
          return {
            categoryId: key === "none" ? null : key,
            name,
            totalMinor: total,
            previousMinor: before,
            changeMinor: total - before,
            changePercent: before ? Math.round(((total - before) / before) * 100) : null,
          };
        })
        .filter((c) => c.changeMinor !== 0)
        .sort((a, b) => Math.abs(b.changeMinor) - Math.abs(a.changeMinor))
        .slice(0, 8)
    : [];

  // "Unusual" only with enough fully covered history to compare against.
  const historyMonths = Array.from({ length: HISTORY_MONTHS }, (_, i) => shiftMonth(month, -(i + 1))).filter(
    (m) => coverageFor(m, imports).coversWholeMonth,
  );
  const unusualCheck = {
    available: coverage.coversWholeMonth && historyMonths.length >= MIN_HISTORY_FOR_UNUSUAL,
    historyMonths: historyMonths.length,
    reason:
      historyMonths.length < MIN_HISTORY_FOR_UNUSUAL
        ? `We need at least ${MIN_HISTORY_FOR_UNUSUAL} complete earlier months to spot unusual spending (you have ${historyMonths.length}).`
        : !coverage.coversWholeMonth
          ? "This month isn't complete yet."
          : null,
  };
  const unusual = unusualCheck.available
    ? current.categories
        .map((c) => {
          const key = c.categoryId ?? "none";
          const history = historyMonths.map(
            (m) => summarise(rowsFor(m)).categories.find((x) => (x.categoryId ?? "none") === key)?.total ?? 0,
          );
          const average = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
          return { categoryId: c.categoryId, name: c.name, totalMinor: c.total, averageMinor: average, months: history.length };
        })
        .filter((c) => c.totalMinor > c.averageMinor * UNUSUAL_FACTOR && c.totalMinor - c.averageMinor >= UNUSUAL_MIN_MINOR)
    : [];

  const limits = (
    (budget.data?.budget_category_limits ?? []) as {
      category_id: string;
      limit_minor: number;
      categories: { name: string } | { name: string }[] | null;
    }[]
  ).map((l) => {
    const spent = current.categories.find((c) => c.categoryId === l.category_id)?.total ?? 0;
    const cat = Array.isArray(l.categories) ? l.categories[0] : l.categories;
    return { name: cat?.name ?? "Category", limitMinor: Number(l.limit_minor), spentMinor: spent, status: limitStatus(Number(l.limit_minor), spent) };
  });

  const rate = savingsRateBp(current.moneyIn, current.moneyOut);
  const byKey = (key: string) => current.categories.find((c) => c.key === key)?.total ?? 0;
  const moneyOutChangePercent =
    comparable && previous.moneyOut ? Math.round(((current.moneyOut - previous.moneyOut) / previous.moneyOut) * 100) : null;
  const health = assessHealth({
    coverage,
    incomeMinor: current.moneyIn,
    spendingMinor: current.moneyOut,
    unclassifiedInMinor: current.unclassifiedIn,
    feesMinor: byKey("bank_fees"),
    debtRepaymentsMinor: byKey("debt_repayments"),
    spendingChangePercent: moneyOutChangePercent,
    budgetStatuses: limits.map((l) => l.status),
  });

  const p = (prefs.data ?? {}) as Record<string, number | null>;
  const b = (budget.data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const goals = {
    // The month's budget plan wins over the general preference.
    expectedIncomeMinor: num(b.expected_income_minor) ?? num(p.expected_monthly_income_minor),
    savingsTargetMinor: num(b.savings_target_minor) ?? num(p.savings_target_minor),
    monthlySpendingTargetMinor: num(p.monthly_budget_target_minor),
  };
  const savedMinor = current.moneyIn - current.moneyOut;

  const limitations: string[] = [];
  if (!coverage.hasImports) limitations.push("No imported statements cover this month.");
  else if (!coverage.coversWholeMonth) limitations.push("Your statements only cover part of this month, so totals may be incomplete.");
  if (coverage.hasWarnings) limitations.push("Some statements for this month imported with warnings.");
  if (comparison.reason && coverage.hasImports) limitations.push(`No month-to-month comparison: ${comparison.reason}`);
  if (current.unclassifiedIn > 0) limitations.push("Some money in isn't marked as income yet, so it isn't counted as income.");

  return {
    month,
    coverage,
    totals: {
      moneyInMinor: current.moneyIn,
      moneyOutMinor: current.moneyOut,
      netMinor: current.netCashFlow,
      refundsMinor: current.refunds,
      unclassifiedInMinor: current.unclassifiedIn,
      previousMoneyOutMinor: comparable ? previous.moneyOut : null,
      moneyOutChangePercent,
      income: current.income,
      debitOrders: current.debitOrders,
      transfersMinor: current.transfers,
    },
    savingsRate: { basisPoints: rate, percent: bpToPercent(rate) },
    health,
    goals: {
      ...goals,
      savingsTargetMet:
        goals.savingsTargetMinor === null || current.moneyIn === 0 ? null : savedMinor >= goals.savingsTargetMinor,
    },
    comparison,
    topCategories: current.categories.slice(0, 5).map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      totalMinor: c.total,
      count: c.count,
      sharePercent: current.moneyOut > 0 ? Math.round((c.total / current.expenses) * 100) : null,
    })),
    savings: savingsIdeas(current.categories, limits),
    changes,
    unusual,
    unusualCheck,
    budget: {
      hasBudget: limits.length > 0,
      overCount: limits.filter((l) => l.status === "exceeded").length,
      limits,
    },
    limitations,
  };
}

/** Everyday categories people can usually trim. Names match the seeded system categories. */
const FLEXIBLE_CATEGORIES = new Set([
  "Eating out & takeaways",
  "Entertainment",
  "Shopping & clothing",
  "Subscriptions",
  "Personal care",
  "Gifts & donations",
  "Airtime & data",
  "Transport & fuel",
  "Groceries",
]);

/**
 * Saving opportunities, calculated by the app (never by AI): how much trimming
 * each flexible category by 10% or 25% would save per month and per year, and
 * how far over budget any limit is.
 */
export function savingsIdeas(
  categories: { categoryId: string | null; name: string; total: number }[],
  limits: { name: string; limitMinor: number; spentMinor: number }[],
) {
  const trims = categories
    .filter((c) => FLEXIBLE_CATEGORIES.has(c.name) && c.total >= 10_000) // at least R100 to be worth mentioning
    .slice(0, 5)
    .map((c) => ({
      name: c.name,
      spentMinor: c.total,
      save10PercentMinor: Math.round(c.total * 0.1),
      save25PercentMinor: Math.round(c.total * 0.25),
      save25PercentYearlyMinor: Math.round(c.total * 0.25) * 12,
    }));
  const overBudget = limits
    .filter((l) => l.spentMinor > l.limitMinor)
    .map((l) => ({ name: l.name, overByMinor: l.spentMinor - l.limitMinor }));
  return { trims, overBudget };
}
