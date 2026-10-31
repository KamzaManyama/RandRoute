/**
 * Column layouts for the six SA banks we have layout rules for, plus the
 * validation flags. Statements are synthetic PDFs built to each bank's
 * published column order (see fixtures.ts) and read with the real pdf.js
 * extraction, so these tests cover the full PDF → rows path.
 */
import { describe, expect, it } from "vitest";
import { extractLines } from "./extractText.js";
import { parseStatement } from "./parser.js";
import { detectChannel } from "./channel.js";
import { guessCategory } from "./categorise.js";
import { BANK_FORMATS } from "./formats.js";
import { detectHeader } from "./layout.js";
import {
  absaColumns,
  buildStatementPdf,
  buildTablePdf,
  capitecColumns,
  fnbStyle,
  nedbankColumns,
  standardBankColumns,
  tymeBankColumns,
  type TableSpec,
} from "./fixtures.js";

const today = new Date("2026-10-31T10:00:00Z");
const parseTable = async (spec: TableSpec, options: Parameters<typeof parseStatement>[1] = {}) =>
  parseStatement(await extractLines(await buildTablePdf(spec)), { today, ...options });
const summary = (rows: { date: string; amountMinor: number; direction: string }[]) =>
  rows.map((r) => [r.date, r.amountMinor, r.direction]);

describe("bank formats", () => {
  it("lists the six major SA banks with layout rules, and says which are generic", () => {
    const withRules = BANK_FORMATS.filter((f) => f.support === "layout_rules").map((f) => f.key);
    expect(withRules).toEqual(["fnb", "capitec", "absa", "standard_bank", "nedbank", "tymebank"]);
    expect(BANK_FORMATS.every((f) => f.status === "beta")).toBe(true);
    expect(BANK_FORMATS.at(-1)!.key).toBe("generic");
  });
});

describe("table header detection", () => {
  const line = (labels: [string, number][]) => ({
    page: 1,
    y: 700,
    text: labels.map(([t]) => t).join("  "),
    cells: labels.map(([text, x]) => ({ text, x, right: x + text.length * 5 })),
  });

  it("recognises debit/credit/fee/balance headings", () => {
    const layout = detectHeader(line([["Date", 30], ["Description", 90], ["Fees", 340], ["Debits", 420], ["Credits", 500], ["Balance", 580]]));
    expect(layout?.columns.map((c) => c.role)).toEqual(["date", "description", "fee", "debit", "credit", "balance"]);
  });

  it("splits merged heading cells", () => {
    const layout = detectHeader(line([["Date Description", 30], ["Amount", 420], ["Balance", 520]]));
    expect(layout?.columns.map((c) => c.role)).toEqual(["date", "description", "amount", "balance"]);
  });

  it("ignores ordinary lines that mention a heading word", () => {
    expect(detectHeader(line([["Balance", 30], ["of your account is shown below", 90]]))).toBeNull();
    expect(detectHeader(line([["01 Sep", 30], ["Payment to Credit Union", 90], ["100.00", 420]]))).toBeNull();
  });
});

describe("SA statement layouts", () => {
  it("Capitec: splits the same-line fee into its own row and still balances", async () => {
    const result = await parseTable(capitecColumns);
    expect(result.bankKey).toBe("capitec");
    expect(result.validation.layout_detected).toBe(true);
    expect(result.validation.balance_check).toBe("passed");
    expect(result.validation.totals_check).toBe("passed");
    expect(result.validation.fee_rows).toBe(1);
    expect(summary(result.rows)).toEqual([
      ["2026-10-01", 25000, "outflow"],
      ["2026-10-02", 50000, "outflow"],
      ["2026-10-02", 1000, "outflow"], // R10 ATM fee from the Fee column
      ["2026-10-05", 120000, "inflow"],
      ["2026-10-07", 18900, "outflow"],
      ["2026-10-31", 750, "outflow"], // fee-only line
    ]);
    expect(result.rows[2]).toMatchObject({ channel: "bank_fee", flags: ["fee_split"] });
    expect(result.rows[1]!.channel).toBe("atm_withdrawal");
    expect(result.rows[4]!.channel).toBe("debit_order");
  });

  it("Absa: reads debit and credit columns, wrapped descriptions, and checks the statement's own totals", async () => {
    const result = await parseTable(absaColumns);
    expect(result.bankKey).toBe("absa");
    expect(result.validation.balance_check).toBe("passed");
    expect(result.validation.column_totals_check).toBe("passed");
    expect(summary(result.rows)).toEqual([
      ["2026-09-01", 65000, "outflow"],
      ["2026-09-03", 41230, "outflow"],
      ["2026-09-15", 1850000, "inflow"],
      ["2026-09-20", 200000, "outflow"],
    ]);
    expect(result.rows[0]!.description).toBe("Acb Debit:External Outsurance Insurance");
    expect(result.rows[0]!.channel).toBe("debit_order");
    // The "A" charge code isn't glued onto the description
    expect(result.rows[1]!.description).toBe("Pos Purchase Spar Centurion");
    expect(result.rows[3]!.channel).toBe("internal_transfer");
  });

  it("Absa: flags a statement whose own totals disagree with the rows", async () => {
    const broken = structuredClone(absaColumns);
    broken.footerLines = [{ label: "Total Debits", amount: "9 999.99" }];
    const result = await parseTable(broken);
    expect(result.validation.column_totals_check).toBe("failed");
    expect(result.validation.has_warnings).toBe(true);
  });

  it("Standard Bank: finds the date when it isn't the first column", async () => {
    const result = await parseTable(standardBankColumns);
    expect(result.bankKey).toBe("standard_bank");
    expect(result.period).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(result.validation.balance_check).toBe("passed");
    expect(summary(result.rows)).toEqual([
      ["2026-08-04", 30000, "outflow"],
      ["2026-08-05", 150000, "outflow"],
      ["2026-08-25", 900000, "inflow"],
    ]);
    expect(result.rows[0]!.description).toBe("Autobank Cash Withdrawal");
  });

  it("Nedbank: with no balance or signs, the Debits/Credits column decides direction", async () => {
    const result = await parseTable(nedbankColumns);
    expect(result.bankKey).toBe("nedbank");
    expect(result.validation.balance_check).toBe("unavailable");
    expect(summary(result.rows)).toEqual([
      ["2026-07-02", 38000, "outflow"],
      ["2026-07-10", 20000, "outflow"],
      ["2026-07-25", 1500000, "inflow"],
    ]);
    // Column-based direction is trusted enough not to need review…
    for (const row of result.rows) expect(row.flags).not.toContain("direction_guessed");
    // …but the missing balance check is still reported.
    expect(result.validation.warnings.join(" ")).toMatch(/no running balance/);
  });

  it("TymeBank: reads newest-first statements in date order", async () => {
    const result = await parseTable(tymeBankColumns);
    expect(result.bankKey).toBe("tymebank");
    expect(result.validation.newest_first).toBe(true);
    expect(result.validation.balance_check).toBe("passed");
    expect(summary(result.rows)).toEqual([
      ["2026-06-05", 10000, "outflow"],
      ["2026-06-10", 200000, "inflow"],
      ["2026-06-20", 15000, "outflow"],
    ]);
  });

  it("FNB: ignores the accrued-charges column instead of double-counting fees", async () => {
    const spec: TableSpec = {
      bankLine: "First National Bank",
      headerLines: ["Statement Period : 01 September 2026 to 30 September 2026"],
      columns: [
        { label: "Date", x: 30, align: "left" },
        { label: "Description", x: 90, align: "left" },
        { label: "Amount", x: 420, align: "right" },
        { label: "Balance", x: 510, align: "right" },
        { label: "Accrued Bank Charges", x: 610, align: "right" },
      ],
      openingLine: { label: "Opening Balance", amount: "1 000.00Cr" },
      rows: [
        { Date: "02 Sep", Description: "ATM Cash Withdrawal", Amount: "200.00", Balance: "800.00Cr", "Accrued Bank Charges": "9.50" },
        { Date: "30 Sep", Description: "#Service Fees", Amount: "9.50", Balance: "790.50Cr" },
      ],
    };
    const result = await parseTable(spec);
    expect(result.validation.balance_check).toBe("passed");
    expect(result.validation.fee_rows).toBe(0);
    expect(summary(result.rows)).toEqual([
      ["2026-09-02", 20000, "outflow"],
      ["2026-09-30", 950, "outflow"],
    ]);
  });
});

describe("row validation flags", () => {
  it("flags repeats, future dates, outside-period and unusually large rows", async () => {
    const spec = structuredClone(nedbankColumns);
    spec.rows = [
      { Date: "02/07/2026", Description: "Taxi Fare", Debits: "20.00" },
      { Date: "02/07/2026", Description: "Taxi Fare", Debits: "20.00" },
      { Date: "15/06/2026", Description: "Pick n Pay", Debits: "100.00" },
      { Date: "20/07/2026", Description: "Property Transfer", Debits: "250 000.00" },
    ];
    const result = await parseTable(spec, { today: new Date("2026-07-10T10:00:00Z") });
    expect(result.rows[0]!.flags).toContain("repeat_in_statement");
    expect(result.rows[1]!.flags).toContain("repeat_in_statement");
    expect(result.rows[2]!.flags).toContain("outside_period");
    expect(result.rows[3]!.flags).toEqual(expect.arrayContaining(["future_date", "large_amount"]));
    expect(result.validation.rows_outside_period).toBe(1);
  });

  it("flags a direction it had to guess (no balance, no column, no sign)", async () => {
    const spec = structuredClone(fnbStyle);
    spec.bankLine = "Example Mutual Bank";
    spec.openingLine = undefined;
    spec.closingLine = undefined;
    spec.rows = spec.rows.slice(0, 3).map((r) => ({ ...r, amount: r.amount.replace("Cr", ""), balance: undefined }));
    const result = parseStatement(await extractLines(await buildStatementPdf(spec)), { today });
    expect(result.bankKey).toBe("generic");
    for (const row of result.rows) expect(row.flags).toContain("direction_guessed");
  });
});

describe("channels and categories", () => {
  it.each([
    ["POS Purchase Checkers Sandton", "outflow", "card_purchase"],
    ["Debit Order Discovery Life", "outflow", "debit_order"],
    ["Acb Debit:External Outsurance", "outflow", "debit_order"],
    ["Autobank Cash Withdrawal", "outflow", "atm_withdrawal"],
    ["FNB App Payment To J Example", "outflow", "eft_payment"],
    ["Magtape Credit Salary", "inflow", "eft_received"],
    ["#Monthly Account Fee", "outflow", "bank_fee"],
    ["Credit Interest", "inflow", "interest"],
    ["Transfer To Savings Own Account", "outflow", "internal_transfer"],
    ["Reversal Woolworths", "inflow", "reversal"],
    ["Vodacom Prepaid Airtime", "outflow", "prepaid"],
  ] as const)("%s → %s", (description, direction, channel) => {
    expect(detectChannel(description, direction)).toBe(channel);
  });

  it("uses the channel for fees, ATM withdrawals, transfers and interest", () => {
    expect(guessCategory("Cash Withdrawal", "outflow", "atm_withdrawal").categoryKey).toBe("cash_withdrawal");
    expect(guessCategory("Admin Fee", "outflow", "bank_fee").categoryKey).toBe("bank_fees");
    expect(guessCategory("Digital Transfer Own Account", "outflow", "internal_transfer")).toMatchObject({
      categoryKey: "transfers",
      transactionType: "transfer",
    });
    expect(guessCategory("Credit Interest", "inflow", "interest")).toMatchObject({ categoryKey: "interest", transactionType: "income" });
  });

  it("suggests side-hustle income from card-machine payouts, but asks the user to confirm", () => {
    const guess = guessCategory("Payment Received Yoco Payout", "inflow", "eft_received");
    expect(guess).toMatchObject({ categoryKey: "side_income", transactionType: "income" });
    expect(guess.confidence).toBeLessThan(0.6);
  });

  it("treats a SARS refund as income, not a shopping refund", () => {
    expect(guessCategory("SARS Tax Refund", "inflow", "reversal")).toMatchObject({ categoryKey: "other_income", transactionType: "income" });
  });

  it("asks the user to name a debit order it can't recognise", () => {
    const guess = guessCategory("Debit Order XYZ123 Pty", "outflow", "debit_order");
    expect(guess.categoryKey).toBe("uncategorised");
    expect(guess.confidence).toBeLessThan(0.6);
  });
});
