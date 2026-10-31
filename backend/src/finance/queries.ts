import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../middleware/errors.js";
import type { FinanceRow, ImportPeriod } from "./rules.js";

const PAGE = 1000;

export type TxRowWithDetails = FinanceRow & {
  id: string;
  cleaned_description: string;
  created_at: string;
};

/** Every transaction between two dates (end exclusive), read in pages so totals are complete. */
export async function fetchTransactions(
  db: SupabaseClient,
  range: { start: string; end: string },
  filters: { sourceId?: string } = {},
): Promise<TxRowWithDetails[]> {
  const rows: TxRowWithDetails[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("transactions")
      .select(
        "id, transaction_date, cleaned_description, amount_minor, direction, transaction_type, excluded_from_totals, category_id, channel, created_at, categories(name, key)",
      )
      .gte("transaction_date", range.start)
      .lt("transaction_date", range.end)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
    const { data, error } = await query;
    if (error) throw new HttpError(502, "database_error", "We couldn't load your transactions. Please try again.");
    rows.push(...((data ?? []) as unknown as TxRowWithDetails[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Imported statements (for coverage), optionally for one source. */
export async function fetchImports(db: SupabaseClient, filters: { sourceId?: string } = {}): Promise<ImportPeriod[]> {
  let query = db
    .from("statement_imports")
    .select("status, period_start, period_end, validation_summary")
    .in("status", ["imported", "partial"])
    .limit(1000);
  if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
  const { data, error } = await query;
  if (error) throw new HttpError(502, "database_error", "We couldn't load your statement coverage. Please try again.");
  return (data ?? []) as ImportPeriod[];
}
