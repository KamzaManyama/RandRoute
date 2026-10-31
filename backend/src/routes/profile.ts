import { Router, type Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { HttpError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { formatName } from "../statements/formats.js";
import { CHANNEL_LABELS, type Channel } from "../statements/channel.js";
import type { SessionCookies } from "../lib/sessionCookies.js";
import { limiter, requireCsrf, securityLog, WINDOWS } from "../middleware/security.js";

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
const password = z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(200);
const deleteAccountSchema = confirmSchema.extend({ password });
const changeEmailSchema = z.object({
  newEmail: z
    .string({ error: "Enter your new email address." })
    .trim()
    .toLowerCase()
    .min(1, { error: "Enter your new email address.", abort: true })
    .max(254, "Email address is too long.")
    .pipe(z.email({ error: "Enter a valid email address." })),
  password,
});

/** Plain-language names for transaction types in exports. */
const TYPE_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Spending",
  transfer: "Transfer",
  refund: "Refund",
  unknown: "Not sure yet",
};

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

export function profileRouter({ config, supabase, cookies }: { config: AppConfig; supabase: SupabaseClients; cookies: SessionCookies }): Router {
  const router = Router();
  router.use(requireAuth(supabase));

  // SECURITY.md 15.1 — per-user limits on account-level actions.
  const deletionLimit = limiter({ name: "account_deletion", windowMs: WINDOWS.DAY, limit: 5, by: "user", message: "Too many delete requests today. Please try again tomorrow." });
  const emailChangeLimit = limiter({ name: "email_change", windowMs: WINDOWS.HOUR, limit: 5, by: "user", message: "Too many attempts. Please wait an hour and try again." });
  const exportLimit = limiter({ name: "export", windowMs: WINDOWS.HOUR, limit: 10, by: "user", message: "Too many downloads. Please wait a while and try again." });

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

  /**
   * Start an email change. Needs the password again. Supabase emails a
   * confirmation link to the new address (and, with "secure email change"
   * on, to the current one too); the sign-in email only changes once the
   * link is opened.
   */
  router.post("/change-email", emailChangeLimit, async (req, res) => {
    const body = parse(changeEmailSchema, req.body);
    const auth = req.auth!;
    if (!auth.email) throw new HttpError(400, "no_email", "This account has no email to confirm with.");
    if (body.newEmail === auth.email.toLowerCase()) {
      throw new HttpError(400, "validation_error", "Please check the highlighted fields.", { newEmail: "That's already your email address." });
    }

    // A fresh client holds the check session in memory, so updateUser acts as this user.
    const client = supabase.auth();
    const check = await client.auth.signInWithPassword({ email: auth.email, password: body.password });
    if (check.error || !check.data.session) {
      securityLog("password_check_failed", req);
      throw new HttpError(401, "wrong_password", "That password isn't right.", { password: "That password isn't right." });
    }
    try {
      const { error } = await client.auth.updateUser({ email: body.newEmail }, { emailRedirectTo: config.supabase.authRedirectUrl });
      if (error) {
        if (error.code === "email_exists" || error.code === "user_already_exists" || error.code === "email_address_invalid") {
          throw new HttpError(400, "validation_error", "Please check the highlighted fields.", { newEmail: "This email address can't be used." });
        }
        if (error.status === 429 || error.code === "over_email_send_rate_limit") {
          throw new HttpError(429, "rate_limited", "Too many emails sent. Please wait a few minutes and try again.");
        }
        console.warn(`[profile] email change failed: ${error.code ?? error.status}`);
        throw new HttpError(502, "auth_unavailable", "We couldn't change your email right now. Please try again later.");
      }
    } finally {
      // End only the check session; the user's own session stays signed in.
      await supabase.admin.auth.admin.signOut(check.data.session.access_token, "local").catch(() => undefined);
    }
    res.status(202).json({ status: "confirmation_sent", newEmail: body.newEmail });
  });

  /** Download saved records as spreadsheets (CSV): transactions or budgets. */
  // Exports need the CSRF token too, even though they are GET requests (SECURITY.md 7.3).
  router.get("/export", exportLimit, requireCsrf(cookies.names.csrf, { always: true }), async (req, res) => {
    const db = req.auth!.db;
    const file = req.query.file === "budgets" ? "budgets" : "transactions";
    const today = new Date().toISOString().slice(0, 10);
    const sendCsv = (name: string, header: string[], rows: unknown[][]) => {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="randroute-${name}-${today}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      // BOM so Excel opens it as UTF-8.
      res.send(`﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`);
    };
    const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

    if (file === "budgets") {
      const { data, error } = await db
        .from("monthly_budgets")
        .select("month, expected_income_minor, savings_target_minor, budget_category_limits(limit_minor, categories(name))")
        .order("month");
      if (error) throw dbError("prepare your export");
      const money = (v: unknown) => (v === null || v === undefined ? "" : rand(Number(v)));
      const rows: unknown[][] = [];
      for (const b of (data ?? []) as Record<string, any>[]) {
        const month = String(b.month).slice(0, 7);
        const limits = (b.budget_category_limits ?? []) as { limit_minor: number; categories: { name: string } | { name: string }[] | null }[];
        const base = [money(b.expected_income_minor), money(b.savings_target_minor)];
        if (!limits.length) rows.push([month, "", "", ...base]);
        for (const l of limits) rows.push([month, one(l.categories)?.name ?? "Category", rand(Number(l.limit_minor)), ...base]);
      }
      sendCsv("budgets", ["Month", "Category", "Limit (R)", "Expected income (R)", "Savings target (R)"], rows);
      return;
    }

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
    const header = ["Date", "Description", "Amount (R)", "Money in or out", "Type", "How it was paid", "Category", "Account", "Counted in totals", "Note"];
    const rows = transactions.map((t) => {
      const source = one(t.statement_sources as { bank_format_key: string; nickname: string | null } | null);
      const signed = t.direction === "outflow" ? -Number(t.amount_minor) : Number(t.amount_minor);
      return [
        t.transaction_date,
        t.cleaned_description,
        rand(signed),
        t.direction === "inflow" ? "Money in" : "Money out",
        TYPE_LABELS[t.transaction_type as string] ?? "Not sure yet",
        CHANNEL_LABELS[(t.channel as Channel | null) ?? "unknown"] ?? "Other",
        one(t.categories as { name: string } | null)?.name ?? "",
        source ? `${formatName(source.bank_format_key)}${source.nickname ? ` ${source.nickname}` : ""}` : "",
        t.excluded_from_totals ? "No" : "Yes",
        t.note ?? "",
      ];
    });
    sendCsv("transactions", header, rows);
  });

  /** Delete every saved financial record but keep the account. */
  router.post("/delete-data", deletionLimit, async (req, res) => {
    parse(confirmSchema, req.body);
    const { error } = await req.auth!.db.rpc("delete_all_financial_records");
    if (error) throw dbError("delete your financial data");
    res.status(204).end();
  });

  /** Delete the account and everything in it. Needs the password again. */
  router.post("/delete-account", deletionLimit, async (req, res) => {
    const body = parse(deleteAccountSchema, req.body);
    const auth = req.auth!;
    if (!auth.email) throw new HttpError(400, "no_email", "This account has no email to confirm with.");

    const check = await supabase.auth().auth.signInWithPassword({ email: auth.email, password: body.password });
    if (check.error || !check.data.session) {
      securityLog("password_check_failed", req);
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

    cookies.clear(res);
    res.status(204).end();
  });

  return router;
}
