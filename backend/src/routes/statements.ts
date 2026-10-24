import { Router, type Request } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { extractLines, PdfReadError } from "../statements/extractText.js";
import { parseStatement, StatementParseError, type ParsedRow } from "../statements/parser.js";
import { guessCategory, REVIEW_THRESHOLD } from "../statements/categorise.js";
import { descriptionSimilarity } from "../statements/clean.js";
import { BANK_FORMATS, formatName, isKnownFormat } from "../statements/formats.js";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const uploadFieldsSchema = z
  .object({
    bankFormat: z.string().trim().default("auto"),
    nickname: z
      .string()
      .trim()
      .max(60, "Use 60 characters or fewer.")
      .optional()
      .transform((v) => (v ? v : undefined)),
    periodStart: isoDate.optional().or(z.literal("").transform(() => undefined)),
    periodEnd: isoDate.optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => v.bankFormat === "auto" || isKnownFormat(v.bankFormat), {
    path: ["bankFormat"],
    message: "Choose a bank from the list.",
  })
  .refine((v) => Boolean(v.periodStart) === Boolean(v.periodEnd), {
    path: ["periodEnd"],
    message: "Enter both the start and end of the statement period, or leave both empty.",
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, {
    path: ["periodEnd"],
    message: "The end date must be on or after the start date.",
  });

const importPatchSchema = z
  .object({
    periodStart: isoDate.optional(),
    periodEnd: isoDate.optional(),
    nickname: z.string().trim().max(60).nullable().optional(),
    bankFormat: z.string().refine(isKnownFormat, "Choose a bank from the list.").optional(),
  })
  .refine((v) => !v.periodStart || !v.periodEnd || v.periodEnd >= v.periodStart, {
    path: ["periodEnd"],
    message: "The end date must be on or after the start date.",
  });

const rowPatchSchema = z
  .object({
    categoryId: z.uuid().nullable().optional(),
    transactionType: z.enum(["income", "expense", "transfer", "refund", "unknown"]).optional(),
    include: z.boolean().optional(),
    transactionDate: isoDate.optional(),
    amountMinor: z
      .number({ error: "Enter an amount." })
      .int("Enter the amount in cents.")
      .positive("Enter an amount greater than zero.")
      .max(100_000_000_000, "That amount is too large.")
      .optional(),
    direction: z.enum(["inflow", "outflow"]).optional(),
    cleanedDescription: z.string().trim().min(1).max(200).optional(),
    duplicateDecision: z.enum(["keep_both", "exclude"]).optional(),
    reviewed: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

const dbError = (what: string) => new HttpError(502, "database_error", `We couldn't ${what}. Please try again.`);

type CategoryRow = { id: string; key: string; name: string; user_id: string | null };

async function loadCategories(db: SupabaseClient): Promise<CategoryRow[]> {
  const { data, error } = await db.from("categories").select("id, key, name, user_id").order("sort_order");
  if (error) throw dbError("load categories");
  return data ?? [];
}

/** Flags staged rows that look like transactions already saved from another statement. */
async function findDuplicates(db: SupabaseClient, rows: ParsedRow[]) {
  const matches = new Map<number, { id: string; reason: string }>();
  if (rows.length === 0) return matches;
  const dates = rows.map((r) => r.date).sort();
  const { data, error } = await db
    .from("transactions")
    .select("id, transaction_date, amount_minor, direction, cleaned_description")
    .gte("transaction_date", dates[0]!)
    .lte("transaction_date", dates.at(-1)!)
    .limit(5000);
  if (error) throw dbError("check for duplicates");

  const byKey = new Map<string, typeof data>();
  for (const t of data ?? []) {
    const key = `${t.transaction_date}|${t.amount_minor}|${t.direction}`;
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const used = new Set<string>();
  for (const row of rows) {
    const candidates = byKey.get(`${row.date}|${row.amountMinor}|${row.direction}`) ?? [];
    // Date + amount alone isn't proof: also require a similar description.
    const match = candidates.find(
      (t) => !used.has(t.id) && descriptionSimilarity(t.cleaned_description, row.description) >= 0.5,
    );
    if (match) {
      used.add(match.id);
      matches.set(row.rowIndex, { id: match.id, reason: "Same date, amount and direction, with a similar description." });
    }
  }
  return matches;
}

/**
 * Data retention: unconfirmed imports older than 24 hours are cancelled and
 * their waiting rows deleted. Runs for the signed-in user whenever they open or
 * upload statements (the database also has cleanup_stale_imports() for a schedule).
 */
async function cancelStaleImports(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("statement_imports")
    .update({ status: "cancelled" })
    .in("status", ["staged", "needs_review"])
    .lt("created_at", cutoff)
    .select("id");
  if (error || !data?.length) return;
  await db.from("staged_transactions").delete().in("import_id", data.map((d) => d.id as string));
}

async function findOrCreateSource(db: SupabaseClient, userId: string, bankKey: string, nickname?: string) {
  let query = db.from("statement_sources").select("id").eq("bank_format_key", bankKey).limit(1);
  query = nickname ? query.eq("nickname", nickname) : query.is("nickname", null);
  const { data: found, error } = await query.maybeSingle();
  if (error) throw dbError("save the statement source");
  if (found) return found.id as string;

  const { data, error: insertError } = await db
    .from("statement_sources")
    .insert({ user_id: userId, bank_format_key: bankKey, nickname: nickname ?? null })
    .select("id")
    .single();
  if (insertError || !data) throw dbError("save the statement source");
  return data.id as string;
}

function toImportSummary(row: Record<string, any>) {
  const validation = (row.validation_summary ?? {}) as Record<string, any>;
  return {
    id: row.id as string,
    bankFormat: row.bank_format_key as string,
    bankName: formatName(row.bank_format_key),
    nickname: (row.statement_sources?.nickname as string | null) ?? null,
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    status: row.status as string,
    transactionCount: row.transaction_count as number,
    importedAt: (row.imported_at as string | null) ?? null,
    createdAt: row.created_at as string,
    warnings: Array.isArray(validation.warnings) ? (validation.warnings as string[]) : [],
    validation: {
      balanceCheck: validation.balance_check ?? "unavailable",
      totalsCheck: validation.totals_check ?? "unavailable",
      mismatchedRows: validation.mismatched_rows ?? 0,
      openingBalanceMinor: validation.opening_balance_minor ?? null,
      closingBalanceMinor: validation.closing_balance_minor ?? null,
      periodSource: validation.period_source ?? "transactions",
      rowCount: validation.row_count ?? 0,
    },
  };
}

const IMPORT_COLUMNS =
  "id, bank_format_key, period_start, period_end, status, transaction_count, imported_at, created_at, validation_summary, statement_sources(nickname)";

export function statementsRouter(supabase: SupabaseClients): Router {
  const router = Router();
  router.use(requireAuth(supabase));

  const upload = multer({
    storage: multer.memoryStorage(), // never written to disk
    limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 10 },
  });
  const uploadLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? "anon",
    handler: (_req, _res, next) =>
      next(new HttpError(429, "rate_limited", "You've uploaded a lot of statements. Please wait a while and try again.")),
  });

  /** Bank formats the upload screen can offer. */
  router.get("/formats", (_req, res) => {
    res.json({ formats: BANK_FORMATS.map(({ key, name, status }) => ({ key, name, status })) });
  });

  /** All imports for the signed-in user, newest first. */
  router.get("/", async (req, res) => {
    await cancelStaleImports(req.auth!.db);
    const { data, error } = await req.auth!.db
      .from("statement_imports")
      .select(IMPORT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw dbError("load your statements");
    res.json({ statements: (data ?? []).map(toImportSummary) });
  });

  /** Upload a PDF: read it in memory, extract rows, and stage them for review. */
  router.post(
    "/upload",
    uploadLimit,
    (req, res, next) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, "file_too_large", "This file is bigger than 10 MB. Upload a single statement."));
        }
        if (err) return next(new HttpError(400, "upload_failed", "The upload didn't work. Please try again."));
        next();
      });
    },
    async (req: Request, res) => {
      const auth = req.auth!;
      const file = req.file;
      if (!file) {
        throw new HttpError(400, "validation_error", "Choose a PDF statement to upload.", { file: "Choose a PDF file." });
      }
      const fields = parseBody(uploadFieldsSchema, req.body);
      await cancelStaleImports(auth.db);

      const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength);
      const isPdf = file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
      if (!isPdf) {
        throw new HttpError(415, "not_a_pdf", "That file isn't a PDF. Download your statement as a PDF and try again.", {
          file: "Only PDF files are supported.",
        });
      }

      let result;
      try {
        const lines = await extractLines(new Uint8Array(bytes)); // copy: pdf.js takes ownership
        result = parseStatement(lines, {
          bankKey: fields.bankFormat,
          period: fields.periodStart && fields.periodEnd ? { start: fields.periodStart, end: fields.periodEnd } : undefined,
        });
      } catch (error) {
        if (error instanceof PdfReadError || error instanceof StatementParseError) {
          throw new HttpError(422, error instanceof PdfReadError ? `pdf_${error.code}` : "no_transactions", error.message);
        }
        console.error(`[statements] parse failed: ${error instanceof Error ? error.name : "unknown"}`);
        throw new HttpError(422, "parse_failed", "We couldn't read the transactions in this statement.");
      } finally {
        file.buffer.fill(0); // drop the PDF bytes from memory straight away
      }

      const categories = await loadCategories(auth.db);
      const categoryByKey = new Map(categories.filter((c) => !c.user_id).map((c) => [c.key, c.id]));
      const duplicates = await findDuplicates(auth.db, result.rows);
      const sourceId = await findOrCreateSource(auth.db, auth.userId, result.bankKey, fields.nickname);

      const staged = result.rows.map((row) => {
        const guess = guessCategory(row.description, row.direction);
        const duplicate = duplicates.get(row.rowIndex);
        const uncertain = row.extractionConfidence < 0.75 || guess.confidence < REVIEW_THRESHOLD || Boolean(duplicate);
        return {
          user_id: auth.userId,
          row_index: row.rowIndex,
          transaction_date: row.date,
          cleaned_description: row.description,
          amount_minor: row.amountMinor,
          direction: row.direction,
          category_id: categoryByKey.get(guess.categoryKey) ?? null,
          transaction_type: guess.transactionType,
          review_status: uncertain ? "needs_review" : "auto_accepted",
          extraction_confidence: row.extractionConfidence,
          category_confidence: guess.confidence,
          include: true,
          duplicate_of_transaction_id: duplicate?.id ?? null,
          duplicate_decision: duplicate ? "unresolved" : null,
        };
      });
      const needsReview = staged.some((r) => r.review_status === "needs_review");

      const { data: created, error: importError } = await auth.db
        .from("statement_imports")
        .insert({
          user_id: auth.userId,
          source_id: sourceId,
          bank_format_key: result.bankKey,
          period_start: result.period.start,
          period_end: result.period.end,
          status: needsReview ? "needs_review" : "staged",
          validation_summary: result.validation,
        })
        .select("id")
        .single();
      if (importError || !created) throw dbError("save the import");

      for (let i = 0; i < staged.length; i += 500) {
        const chunk = staged.slice(i, i + 500).map((r) => ({ ...r, import_id: created.id }));
        const { error } = await auth.db.from("staged_transactions").insert(chunk);
        if (error) {
          // Leave nothing half-staged behind.
          await auth.db.from("statement_imports").delete().eq("id", created.id);
          throw dbError("stage the transactions");
        }
      }

      res.status(201).json({
        importId: created.id,
        rowCount: staged.length,
        needsReview: staged.filter((r) => r.review_status === "needs_review").length,
        duplicates: duplicates.size,
        warnings: result.validation.warnings,
      });
    },
  );

  /** One import with its rows: staged rows while reviewing, saved transactions after import. */
  router.get("/:id", async (req, res) => {
    const db = req.auth!.db;
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "not_found", "Statement not found.");

    const { data: imp, error } = await db.from("statement_imports").select(IMPORT_COLUMNS).eq("id", id.data).maybeSingle();
    if (error) throw dbError("load this statement");
    if (!imp) throw new HttpError(404, "not_found", "Statement not found.");

    const reviewing = imp.status === "staged" || imp.status === "needs_review";
    let rows: unknown[] = [];

    if (reviewing) {
      const { data, error: rowsError } = await db
        .from("staged_transactions")
        .select(
          "id, row_index, transaction_date, cleaned_description, amount_minor, direction, category_id, transaction_type, review_status, extraction_confidence, category_confidence, include, duplicate_decision, duplicate:transactions!staged_transactions_duplicate_of_transaction_id_user_id_fkey(id, transaction_date, cleaned_description, amount_minor, direction, import_id)",
        )
        .eq("import_id", id.data)
        .order("row_index");
      if (rowsError) throw dbError("load the transactions to review");
      rows = (data ?? []).map((r: Record<string, any>) => ({
        id: r.id,
        rowIndex: r.row_index,
        date: r.transaction_date,
        description: r.cleaned_description,
        amountMinor: Number(r.amount_minor),
        direction: r.direction,
        categoryId: r.category_id,
        transactionType: r.transaction_type,
        reviewStatus: r.review_status,
        extractionConfidence: r.extraction_confidence === null ? null : Number(r.extraction_confidence),
        categoryConfidence: r.category_confidence === null ? null : Number(r.category_confidence),
        include: r.include,
        duplicateDecision: r.duplicate_decision,
        duplicateOf: r.duplicate
          ? {
              id: r.duplicate.id,
              date: r.duplicate.transaction_date,
              description: r.duplicate.cleaned_description,
              amountMinor: Number(r.duplicate.amount_minor),
              direction: r.duplicate.direction,
              reason: "Same date, amount and direction, with a similar description.",
            }
          : null,
      }));
    } else {
      const { data, error: txError } = await db
        .from("transactions")
        .select("id, transaction_date, cleaned_description, amount_minor, direction, category_id, transaction_type, review_status")
        .eq("import_id", id.data)
        .order("transaction_date")
        .limit(5000);
      if (txError) throw dbError("load the saved transactions");
      rows = (data ?? []).map((r: Record<string, any>) => ({
        id: r.id,
        date: r.transaction_date,
        description: r.cleaned_description,
        amountMinor: Number(r.amount_minor),
        direction: r.direction,
        categoryId: r.category_id,
        transactionType: r.transaction_type,
        reviewStatus: r.review_status,
      }));
    }

    res.json({ statement: toImportSummary(imp), reviewing, rows });
  });

  /**
   * Correct a statement: the bank or nickname at any time (e.g. if the bank was
   * detected wrongly), and the period while it's still being reviewed.
   */
  router.patch("/:id", async (req, res) => {
    const auth = req.auth!;
    const body = parseBody(importPatchSchema, req.body);
    const { data: imp, error } = await auth.db
      .from("statement_imports")
      .select("id, status, bank_format_key, period_start, period_end, statement_sources(nickname)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw dbError("update this statement");
    if (!imp) throw new HttpError(404, "not_found", "Statement not found.");

    const reviewing = imp.status === "staged" || imp.status === "needs_review";
    const update: Record<string, unknown> = {};

    if (body.periodStart !== undefined || body.periodEnd !== undefined) {
      if (!reviewing) throw new HttpError(409, "already_imported", "The period can only be changed before importing.");
      const start = body.periodStart ?? imp.period_start;
      const end = body.periodEnd ?? imp.period_end;
      if (end < start) {
        throw new HttpError(400, "validation_error", "Please check the highlighted fields.", {
          periodEnd: "The end date must be on or after the start date.",
        });
      }
      update.period_start = start;
      update.period_end = end;
    }

    if (body.nickname !== undefined || body.bankFormat !== undefined) {
      const source = Array.isArray(imp.statement_sources) ? imp.statement_sources[0] : imp.statement_sources;
      const bank = body.bankFormat ?? imp.bank_format_key;
      const nickname = body.nickname !== undefined ? (body.nickname ?? undefined) : ((source as { nickname: string | null } | null)?.nickname ?? undefined);
      const sourceId = await findOrCreateSource(auth.db, auth.userId, bank, nickname);
      update.bank_format_key = bank;
      update.source_id = sourceId;
      // Keep saved transactions pointing at the right account for the Spending filters.
      if (!reviewing) {
        const { error: txError } = await auth.db.from("transactions").update({ source_id: sourceId }).eq("import_id", imp.id);
        if (txError) throw dbError("update this statement");
      }
    }

    if (Object.keys(update).length === 0) throw new HttpError(400, "validation_error", "Nothing to update.");
    const { error: updateError } = await auth.db.from("statement_imports").update(update).eq("id", imp.id);
    if (updateError) throw dbError("update this statement");
    res.status(204).end();
  });

  /** Edit one staged row on the review screen. */
  router.patch("/:id/rows/:rowId", async (req, res) => {
    const db = req.auth!.db;
    const body = parseBody(rowPatchSchema, req.body);

    const { data: row, error } = await db
      .from("staged_transactions")
      .select("id, duplicate_decision, statement_imports!inner(status)")
      .eq("id", req.params.rowId)
      .eq("import_id", req.params.id)
      .maybeSingle();
    if (error) throw dbError("update this row");
    if (!row) throw new HttpError(404, "not_found", "Row not found.");
    const parent = (row as { statement_imports?: { status?: string } | { status?: string }[] }).statement_imports;
    const status = Array.isArray(parent) ? parent[0]?.status : parent?.status;
    if (status !== "staged" && status !== "needs_review") {
      throw new HttpError(409, "already_imported", "This statement has already been imported.");
    }

    const update: Record<string, unknown> = {};
    const valueEdit =
      body.transactionDate !== undefined || body.amountMinor !== undefined || body.direction !== undefined ||
      body.cleanedDescription !== undefined;
    if (body.categoryId !== undefined) update.category_id = body.categoryId;
    if (body.transactionType !== undefined) update.transaction_type = body.transactionType;
    if (body.include !== undefined) update.include = body.include;
    if (body.transactionDate !== undefined) update.transaction_date = body.transactionDate;
    if (body.amountMinor !== undefined) update.amount_minor = body.amountMinor;
    if (body.direction !== undefined) update.direction = body.direction;
    if (body.cleanedDescription !== undefined) update.cleaned_description = body.cleanedDescription;
    if (body.duplicateDecision !== undefined) {
      if (!row.duplicate_decision) throw new HttpError(400, "not_a_duplicate", "This row isn't marked as a possible duplicate.");
      update.duplicate_decision = body.duplicateDecision;
      update.include = body.duplicateDecision !== "exclude";
    }
    update.review_status = valueEdit || body.categoryId !== undefined || body.transactionType !== undefined
      ? "user_edited"
      : "user_confirmed";
    if (body.categoryId !== undefined || body.transactionType !== undefined) update.category_confidence = 1;
    if (valueEdit) update.extraction_confidence = 1;

    const { error: updateError } = await db.from("staged_transactions").update(update).eq("id", row.id);
    if (updateError) throw dbError("update this row");
    res.status(204).end();
  });

  /** Mark every remaining "needs review" row as checked. */
  router.post("/:id/accept-all", async (req, res) => {
    const { error } = await req.auth!.db
      .from("staged_transactions")
      .update({ review_status: "user_confirmed" })
      .eq("import_id", req.params.id)
      .eq("review_status", "needs_review")
      .is("duplicate_decision", null);
    if (error) throw dbError("update the rows");
    res.status(204).end();
  });

  /** Save the reviewed rows as transactions — all at once, or nothing. */
  router.post("/:id/confirm", async (req, res) => {
    const { data, error } = await req.auth!.db.rpc("confirm_import", { p_import_id: req.params.id });
    if (error) {
      if (error.code === "P0002") throw new HttpError(404, "not_found", "Statement not found.");
      if (error.code === "P0001") throw new HttpError(409, "cannot_confirm", error.message);
      throw dbError("import this statement");
    }
    res.json({ saved: data as number });
  });

  /** Cancel an import that hasn't been confirmed. Nothing is saved. */
  router.post("/:id/cancel", async (req, res) => {
    const { error } = await req.auth!.db.rpc("cancel_import", { p_import_id: req.params.id });
    if (error) {
      if (error.code === "P0002") throw new HttpError(404, "not_found", "Statement not found or already finished.");
      throw dbError("cancel this import");
    }
    res.status(204).end();
  });

  /** Delete an import and every transaction saved from it. */
  router.delete("/:id", async (req, res) => {
    const { data, error } = await req.auth!.db.from("statement_imports").delete().eq("id", req.params.id).select("id");
    if (error) throw dbError("delete this statement");
    if (!data?.length) throw new HttpError(404, "not_found", "Statement not found.");
    res.status(204).end();
  });

  return router;
}

export function categoriesRouter(supabase: SupabaseClients): Router {
  const router = Router();
  router.get("/", requireAuth(supabase), async (req, res) => {
    const categories = await loadCategories(req.auth!.db);
    res.json({ categories: categories.map((c) => ({ id: c.id, key: c.key, name: c.name, isSystem: !c.user_id })) });
  });
  return router;
}
