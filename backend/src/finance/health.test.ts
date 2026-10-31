import { describe, expect, it } from "vitest";
import { assessHealth, bpToPercent, formatRand, savingsRateBp, type HealthInput } from "./health.js";
import { currentMonth, summarise, todaySast, type FinanceRow } from "./rules.js";

const base: HealthInput = {
  coverage: { hasImports: true, coversWholeMonth: true },
  incomeMinor: 2_000_000,
  spendingMinor: 1_500_000,
  unclassifiedInMinor: 0,
  feesMinor: 0,
  debtRepaymentsMinor: 0,
  spendingChangePercent: null,
  budgetStatuses: [],
};

describe("formatRand", () => {
  it("formats cents the South African way", () => {
    expect(formatRand(125_050)).toBe("R1 250.50");
    expect(formatRand(5)).toBe("R0.05");
    expect(formatRand(-123_456_789)).toBe("-R1 234 567.89");
  });
});

describe("savings rate", () => {
  it("is the share of income left after spending, in exact basis points", () => {
    expect(savingsRateBp(2_000_000, 1_500_000)).toBe(2500); // 25%
    expect(bpToPercent(savingsRateBp(3_000_000, 2_000_001))).toBe(33.33);
  });
  it("goes negative when spending is higher than income", () => {
    expect(savingsRateBp(1_000_000, 1_200_000)).toBe(-2000);
  });
  it("is unknown without income (never divides by zero)", () => {
    expect(savingsRateBp(0, 50_000)).toBeNull();
    expect(bpToPercent(null)).toBeNull();
  });
});

describe("money health", () => {
  it("is healthy with a good savings rate and budgets on track", () => {
    const health = assessHealth({ ...base, budgetStatuses: ["on_track", "near_limit"] });
    expect(health.level).toBe("healthy");
    expect(health.provisional).toBe(false);
    expect(health.reasons.map((r) => r.code)).toEqual(["good_savings", "budgets_on_track"]);
  });

  it("is at risk when spending is more than income, and says by how much", () => {
    const health = assessHealth({ ...base, spendingMinor: 2_150_000 });
    expect(health.level).toBe("at_risk");
    expect(health.reasons[0]).toMatchObject({ code: "overspent", text: "You spent R1 500.00 more than came in." });
  });

  it("is at risk when loan repayments take 30% or more of income", () => {
    expect(assessHealth({ ...base, debtRepaymentsMinor: 600_000 }).level).toBe("at_risk");
    expect(assessHealth({ ...base, debtRepaymentsMinor: 599_999 }).level).toBe("healthy");
  });

  it("is worth watching with a low savings rate, an overspent budget, a spending jump or high fees", () => {
    expect(assessHealth({ ...base, spendingMinor: 1_850_000 }).reasons[0]!.code).toBe("low_savings");
    expect(assessHealth({ ...base, spendingMinor: 1_850_000 }).level).toBe("watch");
    expect(assessHealth({ ...base, budgetStatuses: ["exceeded", "on_track"] }).level).toBe("watch");
    expect(assessHealth({ ...base, budgetStatuses: ["exceeded", "exceeded", "exceeded"] }).level).toBe("at_risk");
    expect(assessHealth({ ...base, spendingChangePercent: 25 }).level).toBe("watch");
    expect(assessHealth({ ...base, feesMinor: 40_000 }).level).toBe("watch"); // R400 = 2.7% of spending
    expect(assessHealth({ ...base, feesMinor: 9_000 }).level).toBe("healthy"); // under R100
  });

  it("needs data: no statements, or no income marked", () => {
    expect(assessHealth({ ...base, coverage: { hasImports: false, coversWholeMonth: false } }).level).toBe("not_enough_data");
    const unmarked = assessHealth({ ...base, incomeMinor: 0, unclassifiedInMinor: 900_000 });
    expect(unmarked.level).toBe("not_enough_data");
    expect(unmarked.reasons[0]!.code).toBe("income_unmarked");
  });

  it("is labelled provisional for a partial month", () => {
    const health = assessHealth({ ...base, coverage: { hasImports: true, coversWholeMonth: false } });
    expect(health.provisional).toBe(true);
    expect(health.reasons.map((r) => r.code)).toContain("partial_month");
  });
});

describe("income breakdown and debit orders", () => {
  const row = (over: Partial<FinanceRow>): FinanceRow => ({
    transaction_date: "2026-09-10",
    amount_minor: 1000,
    direction: "outflow",
    transaction_type: "expense",
    excluded_from_totals: false,
    ...over,
  });

  it("splits income into salary, side income and other — without counting transfers", () => {
    const totals = summarise([
      row({ direction: "inflow", transaction_type: "income", amount_minor: 2_000_000, categories: { name: "Salary", key: "salary" } }),
      row({ direction: "inflow", transaction_type: "income", amount_minor: 150_000, categories: { name: "Side", key: "side_income" } }),
      row({ direction: "inflow", transaction_type: "income", amount_minor: 2_500, categories: { name: "Interest", key: "interest" } }),
      row({ direction: "inflow", transaction_type: "transfer", amount_minor: 500_000 }),
    ]);
    expect(totals.moneyIn).toBe(2_152_500);
    expect(totals.income).toEqual({ salary: 2_000_000, side: 150_000, other: 2_500 });
    expect(totals.transfers).toBe(500_000);
  });

  it("totals debit orders as fixed commitments", () => {
    const totals = summarise([row({ channel: "debit_order", amount_minor: 45_000 }), row({ channel: "debit_order", amount_minor: 19_900 }), row({ channel: "card_purchase" })]);
    expect(totals.debitOrders).toEqual({ total: 64_900, count: 2 });
  });
});

describe("South African month boundaries", () => {
  it("uses SA time, so just after midnight on the 1st is already the new month", () => {
    expect(currentMonth(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10"); // 00:30 SAST on 1 Oct
    expect(currentMonth(new Date("2026-09-30T21:59:00Z"))).toBe("2026-09");
    expect(todaySast(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  });
});
