import { Router } from "express";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";

type TxRow = {
  id: string;
  transaction_date: string;
  cleaned_description: string;
  amount_minor: number | string;
  direction: "inflow" | "outflow";
  transaction_type: "income" | "expense" | "transfer" | "refund" | "unknown";
  excluded_from_totals: boolean;
  categories: { name: string } | { name: string }[] | null;
};

const PAGE_SIZE = 1000;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** "2026-09" → { start: "2026-09-01", end: "2026-10-01" (exclusive) }. Invalid input → current month. */
function monthRange(input: unknown): { month: string; start: string; end: string } {
  const month = typeof input === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input) ? input : currentMonth();
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);
  return { month, start: `${month}-01`, end: next };
}

function categoryName(row: TxRow): string | null {
  const c = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  return c?.name ?? null;
}

/**
 * Totals follow the README financial rules:
 * - money in = confirmed income only (not transfers, refunds or unknown credits)
 * - money out = expenses, less refunds; transfers are excluded
 */
export function summarise(rows: TxRow[]) {
  let moneyIn = 0;
  let expenses = 0;
  let refunds = 0;
  let unclassifiedIn = 0;
  const categories = new Map<string, { name: string; total: number; count: number }>();

  for (const row of rows) {
    if (row.excluded_from_totals) continue;
    const amount = Number(row.amount_minor);
    if (row.transaction_type === "income" && row.direction === "inflow") moneyIn += amount;
    else if (row.transaction_type === "refund" && row.direction === "inflow") refunds += amount;
    else if (row.transaction_type === "unknown" && row.direction === "inflow") unclassifiedIn += amount;
    else if (row.direction === "outflow" && row.transaction_type !== "transfer") {
      expenses += amount;
      const name = categoryName(row) ?? "Uncategorised";
      const entry = categories.get(name) ?? { name, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      categories.set(name, entry);
    }
  }

  const moneyOut = Math.max(expenses - refunds, 0);
  return {
    moneyIn,
    moneyOut,
    netCashFlow: moneyIn - moneyOut,
    refunds,
    unclassifiedIn,
    topCategories: [...categories.values()].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

export function dashboardRouter(supabase: SupabaseClients): Router {
  const router = Router();

  router.get("/summary", requireAuth(supabase), async (req, res) => {
    const db = req.auth!.db;
    const { month, start, end } = monthRange(req.query.month);

    const { data: prefs, error: prefsError } = await db
      .from("user_preferences")
      .select("monthly_budget_target_minor")
      .maybeSingle();
    if (prefsError) throw new HttpError(502, "dashboard_unavailable", "We couldn't load your dashboard.");

    // Read every transaction in the month (in pages) so totals are complete.
    const rows: TxRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("transactions")
        .select(
          "id, transaction_date, cleaned_description, amount_minor, direction, transaction_type, excluded_from_totals, categories(name)",
        )
        .gte("transaction_date", start)
        .lt("transaction_date", end)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new HttpError(502, "dashboard_unavailable", "We couldn't load your monthly summary.");
      rows.push(...((data ?? []) as TxRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // Imports whose statement period overlaps this month.
    const { data: imports, error: importsError } = await db
      .from("statement_imports")
      .select("id, status, period_start, period_end, validation_summary")
      .in("status", ["imported", "partial"])
      .lte("period_start", end)
      .gte("period_end", start);
    if (importsError) throw new HttpError(502, "dashboard_unavailable", "We couldn't load your statement coverage.");

    const totals = summarise(rows);
    const budgetTarget = (prefs?.monthly_budget_target_minor as number | null | undefined) ?? null;
    const lastDay = new Date(Date.parse(end) - 86_400_000).toISOString().slice(0, 10);
    const coversWholeMonth = (imports ?? []).some((i) => i.period_start <= start && i.period_end >= lastDay);

    res.json({
      month,
      ...totals,
      budgetTarget,
      budgetRemaining: budgetTarget === null ? null : budgetTarget - totals.moneyOut,
      recentTransactions: rows.slice(0, 5).map((row) => ({
        id: row.id,
        date: row.transaction_date,
        description: row.cleaned_description,
        amountMinor: Number(row.amount_minor),
        direction: row.direction,
        transactionType: row.transaction_type,
        categoryName: categoryName(row),
      })),
      coverage: {
        hasImports: (imports ?? []).length > 0,
        statementCount: (imports ?? []).length,
        coversWholeMonth,
        hasWarnings: (imports ?? []).some(
          (i) => i.status === "partial" || Boolean((i.validation_summary as { has_warnings?: boolean } | null)?.has_warnings),
        ),
      },
    });
  });

  return router;
}
