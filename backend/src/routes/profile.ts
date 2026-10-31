import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { formatName } from "../statements/formats.js";
import { REFRESH_COOKIE } from "./auth.js";

/** Bump when the AI explanation text in the app changes, so consent is asked again. */
export const AI_POLICY_VERSION = "2026-11";

const minor = z.number().int().min(0, "Can't be negative.").max(100_000_000_000, "That amount is too large.");

const patchSchema = z
  .object({
    displayName: z.string().trim().max(60, "Use 60 characters or fewer.").nullable().optional(),
    monthlyBudgetTargetMinor: minor.nullable().optional(),
    savingsTargetMinor: minor.nullable().optional(),
    expectedMonthlyIncomeMinor: minor.nullable().optional(),
    setupCompleted: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

const confirmSchema = z.object({ confirm: z.literal("DELETE", { error: 'Type DELETE to confirm.' }) });
const deleteAccountSchema = confirmSchema.extend({ password: z.string().min(1, "Enter your password.").max(200) });

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  throw new HttpError(400, "validation_error", "Please check the highlighted fields.", fields);
}

const dbError = (what: string) => new HttpError(502, "database_error", `We couldn't ${what}. Please try again.`);

/** CSV cell: quote everything, and neutralise spreadsheet formulas (=, +, -, @). */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  const plainNumber = /^-?\d+(\.\d+)?$/.test(text);
  if (/^[=+\-@\t\r]/.test(text) && !plainNumber) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const rand = (minorValue: number) => (minorValue / 100).toFixed(2);

export function profileRouter({ config, supabase }: { config: AppConfig; supabase: SupabaseClients }): Router {
  const router = Router();
  router.use(requireAuth(supabase));

  const dangerLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? "anon",
    handler: (_req, _res, next) => next(new HttpError(429, "rate_limited", "Too many attempts. Please wait a few minutes.")),
  });

  async function loadProfile(req: Request) {
    const { data, error } = await req.auth!.db
      .from("user_preferences")
      .select(
        "display_name, currency, monthly_budget_target_minor, savings_target_minor, expected_monthly_income_minor, setup_completed_at, ai_consent_status, ai_consent_updated_at, ai_consent_policy_version",
      )
      .maybeSingle();
    if (error) throw dbError("load your profile");
    const consentCurrent = data?.ai_consent_status === "granted" && data.ai_consent_policy_version === AI_POLICY_VERSION;
    return {
      email: req.auth!.email ?? null,
      displayName: (data?.display_name as string | null) ?? null,
      currency: (data?.currency as string | undefined) ?? "ZAR",
      monthlyBudgetTargetMinor: data?.monthly_budget_target_minor === null || data?.monthly_budget_target_minor === undefined ? null : Number(data.monthly_budget_target_minor),
      savingsTargetMinor: data?.savings_target_minor === null || data?.savings_target_minor === undefined ? null : Number(data.savings_target_minor),
      expectedMonthlyIncomeMinor:
        data?.expected_monthly_income_minor === null || data?.expected_monthly_income_minor === undefined ? null : Number(data.expected_monthly_income_minor),
      setupCompleted: Boolean(data?.setup_completed_at),
      ai: {
        available: config.ai.enabled,
        consent: consentCurrent ? "granted" : data?.ai_consent_status === "granted" ? "outdated" : ((data?.ai_consent_status as string) ?? "not_asked"),
        consentUpdatedAt: (data?.ai_consent_updated_at as string | null) ?? null,
        policyVersion: AI_POLICY_VERSION,
      },
    };
  }

  router.get("/", async (req, res) => {
    res.json({ profile: await loadProfile(req) });
  });

  /** Update name, targets, or mark setup as done (Screens 03 and 16). */
  router.patch("/", async (req, res) => {
    const body = parse(patchSchema, req.body);
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.display_name = body.displayName || null;
    if (body.monthlyBudgetTargetMinor !== undefined) update.monthly_budget_target_minor = body.monthlyBudgetTargetMinor;
    if (body.savingsTargetMinor !== undefined) update.savings_target_minor = body.savingsTargetMinor;
    if (body.expectedMonthlyIncomeMinor !== undefined) update.expected_monthly_income_minor = body.expectedMonthlyIncomeMinor;
    if (body.setupCompleted) update.setup_completed_at = new Date().toISOString();

    const { error } = await req.auth!.db.from("user_preferences").update(update).eq("user_id", req.auth!.userId);
    if (error) throw dbError("save your profile");

    // Keep the name shown at sign-in in step with the profile.
    if (body.displayName !== undefined) {
      await supabase.admin.auth.admin
        .updateUserById(req.auth!.userId, { user_metadata: { display_name: body.displayName || null } })
        .catch(() => undefined);
    }
    res.json({ profile: await loadProfile(req) });
  });

  /** Give or withdraw consent for AI explanations. */
  router.post("/ai-consent", async (req, res) => {
    const { granted } = parse(z.object({ granted: z.boolean() }), req.body);
    const { error } = await req.auth!.db
      .from("user_preferences")
      .update({
        ai_consent_status: granted ? "granted" : "withdrawn",
        ai_consent_updated_at: new Date().toISOString(),
        ai_consent_policy_version: AI_POLICY_VERSION,
      })
      .eq("user_id", req.auth!.userId);
    if (error) throw dbError("save your AI choice");
    res.json({ profile: await loadProfile(req) });
  });

  /** Download saved records: transactions as CSV, or everything as JSON. */
  router.get("/export", async (req, res) => {
    const db = req.auth!.db;
    const format = req.query.format === "json" ? "json" : "csv";

    const transactions: Record<string, any>[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("transactions")
        .select(
          "transaction_date, cleaned_description, amount_minor, direction, transaction_type, channel, excluded_from_totals, note, categories(name), statement_sources(bank_format_key, nickname)",
        )
        .order("transaction_date")
        .range(from, from + 999);
      if (error) throw dbError("prepare your export");
      transactions.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
    const today = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const header = ["Date", "Description", "Amount (R)", "Direction", "Type", "Channel", "Category", "Account", "Counted in totals", "Note"];
      const lines = transactions.map((t) => {
        const source = one(t.statement_sources as { bank_format_key: string; nickname: string | null } | null);
        const signed = t.direction === "outflow" ? -Number(t.amount_minor) : Number(t.amount_minor);
        return [
          t.transaction_date,
          t.cleaned_description,
          rand(signed),
          t.direction === "inflow" ? "Money in" : "Money out",
          t.transaction_type,
          t.channel ?? "unknown",
          one(t.categories as { name: string } | null)?.name ?? "",
          source ? `${formatName(source.bank_format_key)}${source.nickname ? ` ${source.nickname}` : ""}` : "",
          t.excluded_from_totals ? "No" : "Yes",
          t.note ?? "",
        ]
          .map(csvCell)
          .join(",");
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="randroute-transactions-${today}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(`﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`);
      return;
    }

    const [profile, imports, budgets] = await Promise.all([
      loadProfile(req),
      db.from("statement_imports").select("bank_format_key, period_start, period_end, status, transaction_count, imported_at"),
      db.from("monthly_budgets").select("month, expected_income_minor, savings_target_minor, budget_category_limits(limit_minor, categories(name))"),
    ]);
    if (imports.error || budgets.error) throw dbError("prepare your export");

    res.setHeader("Content-Disposition", `attachment; filename="randroute-export-${today}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      exportedAt: new Date().toISOString(),
      note: "Amounts are in cents (ZAR). Original PDFs are never stored, so they are not included.",
      profile: { email: profile.email, displayName: profile.displayName, currency: profile.currency },
      statements: (imports.data ?? []).map((i) => ({ ...i, bank: formatName(i.bank_format_key as string) })),
      transactions: transactions.map((t) => ({
        date: t.transaction_date,
        description: t.cleaned_description,
        amountMinor: Number(t.amount_minor),
        direction: t.direction,
        type: t.transaction_type,
        channel: t.channel ?? "unknown",
        category: one(t.categories as { name: string } | null)?.name ?? null,
        countedInTotals: !t.excluded_from_totals,
        note: t.note ?? null,
      })),
      budgets: budgets.data ?? [],
    });
  });

  /** Delete every saved financial record but keep the account. */
  router.post("/delete-data", dangerLimit, async (req, res) => {
    parse(confirmSchema, req.body);
    const { error } = await req.auth!.db.rpc("delete_all_financial_records");
    if (error) throw dbError("delete your financial data");
    res.status(204).end();
  });

  /** Delete the account and everything in it. Needs the password again. */
  router.post("/delete-account", dangerLimit, async (req, res) => {
    const body = parse(deleteAccountSchema, req.body);
    const auth = req.auth!;
    if (!auth.email) throw new HttpError(400, "no_email", "This account has no email to confirm with.");

    const check = await supabase.auth().auth.signInWithPassword({ email: auth.email, password: body.password });
    if (check.error || !check.data.session) {
      throw new HttpError(401, "wrong_password", "That password isn't right.", { password: "That password isn't right." });
    }
    // Sign-in check created a session; end it straight away.
    await supabase.admin.auth.admin.signOut(check.data.session.access_token, "global").catch(() => undefined);

    // Remove financial data first (keeps the delete simple and fast), then the login itself.
    const { error: dataError } = await auth.db.rpc("delete_all_financial_records");
    if (dataError) throw dbError("delete your data");
    const { error } = await supabase.admin.auth.admin.deleteUser(auth.userId);
    if (error) {
      console.error(`[profile] account delete failed: ${error.status ?? ""}`);
      throw dbError("delete your account");
    }

    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.cookies.secure, sameSite: config.cookies.sameSite, path: "/api/auth" });
    res.status(204).end();
  });

  return router;
}
