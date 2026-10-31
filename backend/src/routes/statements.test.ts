/**
 * Upload → review → confirm, through the HTTP API with real synthetic PDFs.
 * The database is a fake (see test/fakeDb.ts); the SQL rules themselves are
 * covered by `npm run test:db`.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../createApp.js";
import { loadConfig } from "../config/env.js";
import type { GeminiService } from "../lib/gemini.js";
import type { SupabaseClients } from "../lib/supabase.js";
import { fakeDb } from "../test/fakeDb.js";
import { buildStatementPdf, buildTablePdf, capitecColumns, fnbStyle } from "../statements/fixtures.js";

const env = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
};

const categories = ["groceries", "transport", "airtime_data", "subscriptions", "transfers", "refunds", "salary", "housing", "bank_fees", "cash_withdrawal", "side_income", "insurance", "other_income", "uncategorised"].map(
  (key) => ({ id: `cat-${key}`, key, name: key, user_id: null }),
);

function build(tables: Record<string, unknown[]> = {}, rpc: Record<string, unknown> = {}) {
  const { db, writes } = fakeDb({ categories, transactions: [], statement_imports: [], statement_sources: [], ...tables }, rpc);
  const supabase = {
    auth: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "a@example.com", user_metadata: {} } }, error: null }) } }),
    forUser: () => db,
    admin: { auth: { admin: {} } },
  } as unknown as SupabaseClients;
  const gemini: GeminiService = { isEnabled: false, generateJson: async () => ({}) };
  const app = createApp({ config: loadConfig(env), supabase, gemini });
  const call = (method: "get" | "post", path: string) => request(app)[method](path).set("X-RandRoute-Client", "web").set("Authorization", "Bearer t");
  return { call, writes, db };
}

const inserted = (writes: { table: string; op: string; value?: unknown }[], table: string) =>
  writes.filter((w) => w.table === table && w.op === "insert").flatMap((w) => (Array.isArray(w.value) ? w.value : [w.value])) as Record<string, unknown>[];

describe("statement upload", () => {
  it("stages every row with category, channel and flags, and stores only a fingerprint of the file", async () => {
    const { call, writes } = build();
    const pdf = Buffer.from(await buildStatementPdf(fnbStyle));
    const res = await call("post", "/api/statements/upload").attach("file", pdf, { filename: "s.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rowCount: 10, bankName: "FNB", period: { start: "2026-09-01", end: "2026-09-30" } });

    const [imp] = inserted(writes, "statement_imports");
    expect(imp!.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((imp!.validation_summary as { parser: string }).parser).toBe("column-v2");
    // No raw text or file content is stored anywhere
    expect(JSON.stringify(writes)).not.toMatch(/4111|0820000000|998877665|Example Street/);

    const rows = inserted(writes, "staged_transactions");
    expect(rows).toHaveLength(10);
    const checkers = rows.find((r) => r.cleaned_description === "POS Purchase Checkers Sandton")!;
    expect(checkers).toMatchObject({ amount_minor: 45000, direction: "outflow", channel: "card_purchase", category_id: "cat-groceries", flags: [] });
    const salary = rows.find((r) => String(r.cleaned_description).startsWith("Salary"))!;
    expect(salary).toMatchObject({ direction: "inflow", transaction_type: "income", category_id: "cat-salary" });
    // An unknown shop needs the user's eye
    expect(rows.find((r) => r.cleaned_description === "Mystery Shop Pty Ltd")!.review_status).toBe("needs_review");
  });

  it("stages the Capitec fee as its own bank-fee row", async () => {
    const { call, writes } = build();
    const pdf = Buffer.from(await buildTablePdf(capitecColumns));
    const res = await call("post", "/api/statements/upload").attach("file", pdf, { filename: "c.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    const fee = inserted(writes, "staged_transactions").find((r) => String(r.cleaned_description).startsWith("Fee:"))!;
    expect(fee).toMatchObject({ amount_minor: 1000, channel: "bank_fee", category_id: "cat-bank_fees", flags: ["fee_split"] });
  });

  it("refuses the exact same file a second time", async () => {
    const { call, writes } = build({ statement_imports: [{ id: "imp-old", status: "imported" }] });
    const pdf = Buffer.from(await buildStatementPdf(fnbStyle));
    const res = await call("post", "/api/statements/upload").attach("file", pdf, { filename: "s.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("duplicate_statement");
    expect(res.body.error.fields.existingImportId).toBe("imp-old");
    expect(inserted(writes, "staged_transactions")).toHaveLength(0);
  });

  it("rejects files that aren't PDFs", async () => {
    const { call } = build();
    const res = await call("post", "/api/statements/upload").attach("file", Buffer.from("hello"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(415);
  });

  it("lists supported banks and how well each is supported", async () => {
    const { call } = build();
    const res = await call("get", "/api/statements/formats");
    expect(res.body.formats.find((f: { key: string }) => f.key === "capitec")).toMatchObject({ support: "layout_rules", status: "beta" });
    expect(res.body.formats.find((f: { key: string }) => f.key === "generic")).toMatchObject({ support: "generic" });
  });
});

describe("statement confirmation", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("passes the user's acknowledgement to the database", async () => {
    let received: unknown;
    const { call } = build({}, { confirm_import: (args: unknown) => ((received = args), { data: 7, error: null }) });
    const res = await call("post", `/api/statements/${id}/confirm`).send({ acknowledgeWarnings: true });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(7);
    expect(received).toEqual({ p_import_id: id, p_acknowledge_warnings: true });
  });

  it.each([
    ["RRREV", "rows_need_review"],
    ["RRACK", "warnings_not_acknowledged"],
    ["RRDUP", "duplicates_unresolved"],
    ["RRNON", "nothing_to_import"],
  ])("explains a refused confirmation (%s)", async (code, apiCode) => {
    const { call } = build({}, { confirm_import: () => ({ data: null, error: { code, message: "Check 2 row(s) marked for review before confirming" } }) });
    const res = await call("post", `/api/statements/${id}/confirm`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(apiCode);
  });
});
