import { Router } from "express";
import { z } from "zod";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { fetchImports, fetchTransactions } from "../finance/queries.js";
import {
  categoryNameOf,
  coverageFor,
  currentMonth,
  isMonth,
  monthRange,
  recurringCandidates,
  shiftMonth,
  summarise,
} from "../finance/rules.js";
import { formatName } from "../statements/formats.js";

const TYPES = ["income", "expense", "transfer", "refund", "unknown"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const TREND_MONTHS = 6;

const listQuery = z.object({
  month: z.string().optional(), // "YYYY-MM"; omit for all history
  q: z.string().trim().max(100).optional(),
  categoryId: z.union([z.uuid(), z.literal("none")]).optional(),
  type: z.enum(TYPES).optional(),
  sourceId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const patchBody = z
  .object({
    categoryId: z.uuid().nullable().optional(),
    transactionType: z.enum(TYPES).optional(),
    note: z.string().trim().max(500, "Use 500 characters or fewer.").nullable().optional(),
    transactionDate: isoDate.optional(),
    cleanedDescription: z.string().trim().min(1, "Enter a description.").max(200, "Use 200 characters or fewer.").optional(),
    amountMinor: z
      .number({ error: "Enter an amount." })
      .int("Enter the amount in cents.")
      .positive("Enter an amount greater than zero.")
      .max(100_000_000_000, "That amount is too large.")
      .optional(),
    direction: z.enum(["inflow", "outflow"]).optional(),
    excludedFromTotals: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

/** Escapes % and _ so a search for "50%" matches the text, not a wildcard. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const dbError = (what: string) => new HttpError(502, "database_error", `We couldn't ${what}. Please try again.`);

const LIST_COLUMNS =
  "id, transaction_date, cleaned_description, amount_minor, direction, transaction_type, category_id, excluded_from_totals, import_id, categories(name), statement_sources(bank_format_key, nickname)";

type ListRow = {
  id: string;
  transaction_date: string;
  cleaned_description: string;
  amount_minor: number | string;
  direction: "inflow" | "outflow";
  transaction_type: (typeof TYPES)[number];
  category_id: string | null;
  excluded_from_totals: boolean;
  import_id: string;
  note?: string | null;
  review_status?: string;
  categories: { name: string } | { name: string }[] | null;
  statement_sources: { bank_format_key: string; nickname: string | null } | { bank_format_key: string; nickname: string | null }[] | null;
};

function toTransaction(row: ListRow) {
  const source = Array.isArray(row.statement_sources) ? row.statement_sources[0] : row.statement_sources;
  return {
    id: row.id,
    date: row.transaction_date,
    description: row.cleaned_description,
    amountMinor: Number(row.amount_minor),
    direction: row.direction,
    transactionType: row.transaction_type,
    categoryId: row.category_id,
    categoryName: categoryNameOf({ ...row, amount_minor: 0 } as never),
    excludedFromTotals: row.excluded_from_totals,
    importId: row.import_id,
    source: source ? { bankName: formatName(source.bank_format_key), nickname: source.nickname } : null,
  };
}

export function spendingRouter(supabase: SupabaseClients): Router {
  const router = Router();
  const auth = requireAuth(supabase);

  /**
   * Screen 10 — category totals for a month, compared with the month before,
   * plus a six-month trend and possible recurring payments.
   */
  router.get("/spending/summary", auth, async (req, res) => {
    const db = req.auth!.db;
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const sourceId = z.uuid().safeParse(req.query.sourceId).data;

    const firstTrendMonth = shiftMonth(month, -(TREND_MONTHS - 1));
    const [rows, imports] = await Promise.all([
      fetchTransactions(db, { start: monthRange(firstTrendMonth).start, end: monthRange(month).end }, { sourceId }),
      fetchImports(db, { sourceId }),
    ]);

    const byMonth = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.transaction_date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
    }

    const previousMonth = shiftMonth(month, -1);
    const current = summarise(byMonth.get(month) ?? []);
    const previous = summarise(byMonth.get(previousMonth) ?? []);
    const coverage = coverageFor(month, imports);
    const previousCoverage = coverageFor(previousMonth, imports);

    // Only compare equivalent periods: both months fully covered by statements.
    let comparison: { month: string; available: boolean; reason: string | null };
    if (!coverage.coversWholeMonth) {
      comparison = { month: previousMonth, available: false, reason: "This month isn't fully covered by your statements yet." };
    } else if (!previousCoverage.coversWholeMonth) {
      comparison = { month: previousMonth, available: false, reason: "Last month isn't fully covered by your statements." };
    } else {
      comparison = { month: previousMonth, available: true, reason: null };
    }

    const previousByCategory = new Map(previous.categories.map((c) => [c.categoryId ?? "none", c.total]));
    const categories = current.categories.map((c) => {
      const before = comparison.available ? (previousByCategory.get(c.categoryId ?? "none") ?? 0) : null;
      return {
        ...c,
        share: current.expenses > 0 ? c.total / current.expenses : 0,
        previousTotal: before,
        changePercent: before ? Math.round(((c.total - before) / before) * 100) : null,
      };
    });

    const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const m = shiftMonth(firstTrendMonth, i);
      const totals = summarise(byMonth.get(m) ?? []);
      const cov = coverageFor(m, imports);
      return { month: m, moneyIn: totals.moneyIn, moneyOut: totals.moneyOut, coverage: cov.coversWholeMonth ? "full" : cov.hasImports ? "partial" : "none" };
    });

    res.json({
      month,
      moneyIn: current.moneyIn,
      moneyOut: current.moneyOut,
      netCashFlow: current.netCashFlow,
      refunds: current.refunds,
      transfers: current.transfers,
      unclassifiedIn: current.unclassifiedIn,
      transactionCount: (byMonth.get(month) ?? []).length,
      categories,
      comparison: { ...comparison, previousMoneyOut: comparison.available ? previous.moneyOut : null },
      coverage,
      trend,
      recurring: recurringCandidates(rows),
    });
  });

  /** Search and filter saved transactions — the whole history, or one month. */
  router.get("/transactions", auth, async (req, res) => {
    const q = parse(listQuery, req.query);
    if (q.month && !isMonth(q.month)) {
      throw new HttpError(400, "validation_error", "Choose a valid month.", { month: "Use YYYY-MM." });
    }

    // The same filters for the page query and (if needed) a count-only query.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = <Q extends { gte: any; lt: any; ilike: any; is: any; eq: any }>(query: Q): Q => {
      let out = query;
      if (q.month) {
        const { start, end } = monthRange(q.month);
        out = out.gte("transaction_date", start).lt("transaction_date", end);
      }
      if (q.q) out = out.ilike("cleaned_description", likePattern(q.q));
      if (q.categoryId === "none") out = out.is("category_id", null);
      else if (q.categoryId) out = out.eq("category_id", q.categoryId);
      if (q.type) out = out.eq("transaction_type", q.type);
      if (q.sourceId) out = out.eq("source_id", q.sourceId);
      return out;
    };

    const db = req.auth!.db;
    const { data, error, count } = await applyFilters(
      db
        .from("transactions")
        .select(LIST_COLUMNS, { count: "exact" })
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(q.offset, q.offset + q.limit - 1),
    );

    if (error) {
      // A page past the end (e.g. after deleting rows) is an empty page, not a failure.
      if (error.code === "PGRST103") {
        const { count: total, error: countError } = await applyFilters(
          db.from("transactions").select("id", { count: "exact", head: true }),
        );
        if (countError) throw dbError("load your transactions");
        res.json({ transactions: [], total: total ?? 0, offset: q.offset, limit: q.limit });
        return;
      }
      throw dbError("load your transactions");
    }
    res.json({
      transactions: ((data ?? []) as unknown as ListRow[]).map(toTransaction),
      total: count ?? 0,
      offset: q.offset,
      limit: q.limit,
    });
  });

  /** Screen 11 — one transaction. */
  router.get("/transactions/:id", auth, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Transaction not found.");
    const { data, error } = await req
      .auth!.db.from("transactions")
      .select(`${LIST_COLUMNS}, note, review_status, statement_imports(period_start, period_end, imported_at)`)
      .eq("id", id.data)
      .maybeSingle();
    if (error) throw dbError("load this transaction");
    if (!data) throw new HttpError(404, "not_found", "Transaction not found.");

    const row = data as unknown as ListRow & {
      statement_imports: { period_start: string; period_end: string; imported_at: string | null } | null;
    };
    const imp = Array.isArray(row.statement_imports) ? row.statement_imports[0] : row.statement_imports;
    res.json({
      transaction: {
        ...toTransaction(row),
        note: row.note ?? null,
        reviewStatus: row.review_status,
        statement: imp ? { periodStart: imp.period_start, periodEnd: imp.period_end, importedAt: imp.imported_at } : null,
      },
    });
  });

  /** Edit a saved transaction. Totals and budgets recalculate from the saved rows. */
  router.patch("/transactions/:id", auth, async (req, res) => {
    const body = parse(patchBody, req.body);
    const update: Record<string, unknown> = { review_status: "user_edited" };
    if (body.categoryId !== undefined) {
      update.category_id = body.categoryId;
      update.category_confidence = 1;
    }
    if (body.transactionType !== undefined) update.transaction_type = body.transactionType;
    if (body.note !== undefined) update.note = body.note || null;
    if (body.transactionDate !== undefined) update.transaction_date = body.transactionDate;
    if (body.cleanedDescription !== undefined) update.cleaned_description = body.cleanedDescription;
    if (body.amountMinor !== undefined) update.amount_minor = body.amountMinor;
    if (body.direction !== undefined) update.direction = body.direction;
    if (body.excludedFromTotals !== undefined) update.excluded_from_totals = body.excludedFromTotals;

    const { data, error } = await req.auth!.db.from("transactions").update(update).eq("id", req.params.id).select("id");
    if (error) {
      if (error.code === "42501") throw new HttpError(400, "validation_error", "Choose one of your categories.", { categoryId: "Choose a category from the list." });
      throw dbError("save this change");
    }
    if (!data?.length) throw new HttpError(404, "not_found", "Transaction not found.");
    res.status(204).end();
  });

  /** Delete one saved transaction (the import's count updates automatically). */
  router.delete("/transactions/:id", auth, async (req, res) => {
    const { data, error } = await req.auth!.db.from("transactions").delete().eq("id", req.params.id).select("id");
    if (error) throw dbError("delete this transaction");
    if (!data?.length) throw new HttpError(404, "not_found", "Transaction not found.");
    res.status(204).end();
  });

  /** Statement sources for the source filter. */
  router.get("/sources", auth, async (req, res) => {
    const { data, error } = await req
      .auth!.db.from("statement_sources")
      .select("id, bank_format_key, nickname")
      .order("created_at");
    if (error) throw dbError("load your accounts");
    res.json({
      sources: (data ?? []).map((s) => ({
        id: s.id as string,
        bankName: formatName(s.bank_format_key as string),
        nickname: (s.nickname as string | null) ?? null,
      })),
    });
  });

  return router;
}
