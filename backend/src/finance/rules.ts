/**
 * The README's financial calculation rules, in one place, so Home, Spending
 * and Insights always agree. All amounts are integer cents.
 *
 * - Money in  = confirmed income only (not transfers, refunds or unknown credits)
 * - Money out = expenses minus refunds; transfers between own accounts excluded
 * - Rows marked "excluded from totals" are ignored
 */

export type TransactionType = "income" | "expense" | "transfer" | "refund" | "unknown";
export type Direction = "inflow" | "outflow";

export type FinanceRow = {
  transaction_date: string;
  amount_minor: number | string;
  direction: Direction;
  transaction_type: TransactionType;
  excluded_from_totals: boolean;
  category_id?: string | null;
  categories?: { name: string } | { name: string }[] | null;
};

export function categoryNameOf(row: FinanceRow): string | null {
  const c = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  return c?.name ?? null;
}

/** Counts toward spending (money out)? */
export function isSpending(row: FinanceRow): boolean {
  return !row.excluded_from_totals && row.direction === "outflow" && row.transaction_type !== "transfer";
}

export type CategoryTotal = { categoryId: string | null; name: string; total: number; count: number };

export function summarise(rows: FinanceRow[]) {
  let moneyIn = 0;
  let expenses = 0;
  let refunds = 0;
  let unclassifiedIn = 0;
  let transfers = 0;
  const categories = new Map<string, CategoryTotal>();

  for (const row of rows) {
    if (row.excluded_from_totals) continue;
    const amount = Number(row.amount_minor);
    if (row.transaction_type === "transfer") {
      transfers += amount;
      continue;
    }
    if (row.direction === "inflow") {
      if (row.transaction_type === "income") moneyIn += amount;
      else if (row.transaction_type === "refund") refunds += amount;
      else unclassifiedIn += amount; // unknown, or an "expense" marked as money in
      continue;
    }
    expenses += amount;
    const key = row.category_id ?? "none";
    const entry = categories.get(key) ?? {
      categoryId: row.category_id ?? null,
      name: categoryNameOf(row) ?? "Uncategorised",
      total: 0,
      count: 0,
    };
    entry.total += amount;
    entry.count += 1;
    categories.set(key, entry);
  }

  const moneyOut = Math.max(expenses - refunds, 0);
  return {
    moneyIn,
    moneyOut,
    netCashFlow: moneyIn - moneyOut,
    expenses,
    refunds,
    transfers,
    unclassifiedIn,
    categories: [...categories.values()].sort((a, b) => b.total - a.total),
  };
}

// ---------------------------------------------------------------------------
// Months and statement coverage
// ---------------------------------------------------------------------------

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** { start: first day, end: first day of next month (exclusive), last: last day } */
export function monthRange(month: string) {
  const start = `${month}-01`;
  const end = `${shiftMonth(month, 1)}-01`;
  const last = new Date(Date.parse(end) - 86_400_000).toISOString().slice(0, 10);
  return { start, end, last };
}

export type ImportPeriod = {
  status: string;
  period_start: string;
  period_end: string;
  validation_summary?: { has_warnings?: boolean } | null;
};

export type Coverage = {
  hasImports: boolean;
  statementCount: number;
  coversWholeMonth: boolean;
  hasWarnings: boolean;
};

/**
 * How well imported statements cover a month. "Whole month" means the
 * statement periods (together) span every day of it.
 */
export function coverageFor(month: string, imports: ImportPeriod[]): Coverage {
  const { start, last } = monthRange(month);
  const overlapping = imports.filter(
    (i) => (i.status === "imported" || i.status === "partial") && i.period_start <= last && i.period_end >= start,
  );

  // Walk the month day by day through the merged statement periods.
  const periods = overlapping.map((i) => [i.period_start, i.period_end] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let coveredUntil = start; // first day not yet covered
  for (const [from, to] of periods) {
    if (from > coveredUntil) break;
    if (to >= coveredUntil) coveredUntil = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
  }

  return {
    hasImports: overlapping.length > 0,
    statementCount: overlapping.length,
    coversWholeMonth: coveredUntil > last,
    hasWarnings: overlapping.some((i) => i.status === "partial" || Boolean(i.validation_summary?.has_warnings)),
  };
}

// ---------------------------------------------------------------------------
// Recurring payment candidates (estimates — never presented as fact)
// ---------------------------------------------------------------------------

export type RecurringCandidate = {
  description: string;
  typicalAmountMinor: number;
  months: number;
  lastDate: string;
  categoryName: string | null;
};

function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["pos", "purchase", "debit", "order", "payment", "card", "the"].includes(w))
    .slice(0, 3)
    .join(" ");
}

/** Outflows from the same merchant in 3+ different months with a steady amount (±15%). */
export function recurringCandidates(rows: (FinanceRow & { cleaned_description: string })[]): RecurringCandidate[] {
  const groups = new Map<string, (FinanceRow & { cleaned_description: string })[]>();
  for (const row of rows) {
    if (!isSpending(row)) continue;
    const key = merchantKey(row.cleaned_description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const result: RecurringCandidate[] = [];
  for (const items of groups.values()) {
    const months = new Set(items.map((r) => r.transaction_date.slice(0, 7)));
    if (months.size < 3) continue;
    const amounts = items.map((r) => Number(r.amount_minor)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)]!;
    const steady = amounts.filter((a) => Math.abs(a - median) <= median * 0.15).length / amounts.length >= 0.75;
    if (!steady) continue;
    const latest = items.reduce((a, b) => (a.transaction_date > b.transaction_date ? a : b));
    result.push({
      description: latest.cleaned_description,
      typicalAmountMinor: median,
      months: months.size,
      lastDate: latest.transaction_date,
      categoryName: categoryNameOf(latest),
    });
  }
  return result.sort((a, b) => b.typicalAmountMinor - a.typicalAmountMinor).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export type LimitStatus = "on_track" | "near_limit" | "reached" | "exceeded";

/** README: remaining = limit − qualifying spending (may be negative). */
export function limitStatus(limit: number, spent: number): LimitStatus {
  if (spent > limit) return "exceeded";
  if (limit > 0 && spent === limit) return "reached";
  if (limit > 0 && spent >= limit * 0.85) return "near_limit";
  if (limit === 0 && spent > 0) return "exceeded";
  return "on_track";
}
