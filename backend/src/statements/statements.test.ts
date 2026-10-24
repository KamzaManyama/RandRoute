import { describe, expect, it } from "vitest";
import { parseAmount } from "./money.js";
import { findPeriod, parseDateToken, resolveDate } from "./dates.js";
import { cleanDescription, descriptionSimilarity } from "./clean.js";
import { guessCategory } from "./categorise.js";
import { extractLines, PdfReadError } from "./extractText.js";
import { parseStatement, StatementParseError } from "./parser.js";
import { buildStatementPdf, capitecStyle, fnbStyle } from "./fixtures.js";

describe("parseAmount", () => {
  it.each([
    ["1 234.56", 123456, 0],
    ["1,234.56", 123456, 0],
    ["R 45.00", 4500, 0],
    ["-45.00", 4500, -1],
    ["45.00-", 4500, -1],
    ["21 483.50Cr", 2148350, 1],
    ["99.99 Dr", 9999, -1],
    ["(12.00)", 1200, -1],
    ["0.10", 10, 0],
  ])("%s → %i cents", (text, minor, marker) => {
    expect(parseAmount(text)).toEqual({ minor, marker });
  });

  it.each(["abc", "12", "1.2", "2026", "01 Sep", "(12.00"])("rejects %s", (text) => {
    expect(parseAmount(text)).toBeNull();
  });
});

describe("dates", () => {
  it("parses SA date styles", () => {
    expect(parseDateToken("01 Sep")).toEqual({ day: 1, month: 9, year: null });
    expect(parseDateToken("1 September 2026")).toEqual({ day: 1, month: 9, year: 2026 });
    expect(parseDateToken("05/10/2026")).toEqual({ day: 5, month: 10, year: 2026 });
    expect(parseDateToken("2026-10-05")).toEqual({ day: 5, month: 10, year: 2026 });
    expect(parseDateToken("32 Sep")).toBeNull();
  });

  it("puts December rows on a January statement in the previous year", () => {
    expect(resolveDate({ day: 30, month: 12, year: null }, "2027-01-15", 2027)).toBe("2026-12-30");
    expect(resolveDate({ day: 2, month: 1, year: null }, "2027-01-15", 2027)).toBe("2027-01-02");
  });

  it("finds the statement period", () => {
    expect(findPeriod("Statement Period : 01 September 2026 to 30 September 2026")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(findPeriod("Statement period: 01/10/2026 - 31/10/2026")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
});

describe("cleanDescription", () => {
  it("removes card numbers, account numbers, phone numbers and emails", () => {
    const cleaned = cleanDescription("POS Purchase Checkers 4111********1234 acc 62000000001 call 0820000000 me@x.co");
    expect(cleaned).toBe("POS Purchase Checkers call");
    expect(cleaned).not.toMatch(/\d{6,}/);
  });

  it("keeps short numbers that are part of the merchant", () => {
    expect(cleanDescription("Spar 24 Hour Store")).toBe("Spar 24 Hour Store");
  });

  it("compares descriptions by shared words", () => {
    expect(descriptionSimilarity("POS Checkers Sandton", "Checkers Sandton")).toBe(1);
    expect(descriptionSimilarity("Uber Trip", "Netflix")).toBe(0);
  });
});

describe("guessCategory", () => {
  it.each([
    ["POS Purchase Checkers Sandton", "outflow", "groceries", "expense"],
    ["Uber Eats Order", "outflow", "eating_out", "expense"],
    ["Uber Trip", "outflow", "transport", "expense"],
    ["Netflix.com", "outflow", "subscriptions", "expense"],
    ["Salary ACME Holdings", "inflow", "salary", "income"],
    ["Transfer From Savings Own Acc", "inflow", "transfers", "transfer"],
    ["Woolworths Refund", "inflow", "refunds", "refund"],
    ["#Monthly Account Fee", "outflow", "bank_fees", "expense"],
  ] as const)("%s → %s", (description, direction, key, type) => {
    const guess = guessCategory(description, direction);
    expect(guess.categoryKey).toBe(key);
    expect(guess.transactionType).toBe(type);
    expect(guess.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does not treat an unknown credit as income", () => {
    const guess = guessCategory("Payment Received J Example", "inflow");
    expect(guess.transactionType).toBe("unknown");
    expect(guess.confidence).toBeLessThan(0.6);
  });

  it("does not match short words inside other words", () => {
    expect(guessCategory("Current account parent", "outflow").categoryKey).toBe("uncategorised");
  });
});

describe("PDF → transactions", () => {
  it("reads an FNB-style statement and checks every row against the balance", async () => {
    const lines = await extractLines(await buildStatementPdf(fnbStyle));
    const result = parseStatement(lines, { today: new Date("2026-10-24") });

    expect(result.bankKey).toBe("fnb");
    expect(result.period).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(result.rows).toHaveLength(10);
    expect(result.validation.balance_check).toBe("passed");
    expect(result.validation.totals_check).toBe("passed");
    expect(result.validation.has_warnings).toBe(false);

    expect(result.rows[0]).toMatchObject({
      date: "2026-09-01",
      description: "POS Purchase Checkers Sandton",
      amountMinor: 45000,
      direction: "outflow",
      balanceCheck: "ok",
    });
    expect(result.rows[6]).toMatchObject({ date: "2026-09-25", amountMinor: 2500000, direction: "inflow" });
    // Sensitive numbers never make it into stored descriptions
    for (const row of result.rows) expect(row.description).not.toMatch(/\d{6,}/);
  });

  it("reads a Capitec-style statement with minus signs", async () => {
    const lines = await extractLines(await buildStatementPdf(capitecStyle));
    const result = parseStatement(lines);
    expect(result.bankKey).toBe("capitec");
    expect(result.rows.map((r) => [r.date, r.amountMinor, r.direction])).toEqual([
      ["2026-10-01", 31025, "outflow"],
      ["2026-10-03", 50000, "outflow"],
      ["2026-10-05", 200000, "inflow"],
      ["2026-10-07", 35000, "outflow"],
    ]);
    expect(result.validation.totals_check).toBe("passed");
  });

  it("reads statements that span several pages", async () => {
    const lines = await extractLines(await buildStatementPdf({ ...fnbStyle, rowsPerPage: 4 }));
    const result = parseStatement(lines, { today: new Date("2026-10-24") });
    expect(result.rows).toHaveLength(10);
    expect(result.validation.balance_check).toBe("passed");
  });

  it("flags rows that don't match the running balance", async () => {
    const broken = structuredClone(fnbStyle);
    broken.rows[1]!.amount = "98.50"; // typo vs balance change of 89.50
    const result = parseStatement(await extractLines(await buildStatementPdf(broken)), { today: new Date("2026-10-24") });
    expect(result.validation.balance_check).toBe("mismatch");
    expect(result.validation.mismatched_rows).toBe(1);
    expect(result.rows[1]!.extractionConfidence).toBeLessThan(0.75);
    expect(result.validation.has_warnings).toBe(true);
  });

  it("uses the period the user typed in", async () => {
    const lines = await extractLines(await buildStatementPdf(fnbStyle));
    const result = parseStatement(lines, { period: { start: "2026-09-01", end: "2026-09-30" } });
    expect(result.validation.period_source).toBe("user");
  });

  it("explains when no transactions are found", async () => {
    const lines = await extractLines(await buildStatementPdf({ bankLine: "Tax certificate 2026", headerLines: ["Total 100.00"], rows: [] }));
    expect(() => parseStatement(lines)).toThrow(StatementParseError);
  });

  it("rejects files that aren't PDFs", async () => {
    await expect(extractLines(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(PdfReadError);
  });
});
