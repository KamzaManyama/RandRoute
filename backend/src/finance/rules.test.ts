import { describe, expect, it } from "vitest";
import { coverageFor, monthRange, recurringCandidates, shiftMonth, summarise, type FinanceRow } from "./rules.js";

const tx = (over: Partial<FinanceRow & { cleaned_description: string }> = {}) => ({
  transaction_date: "2026-09-10",
  amount_minor: 10000,
  direction: "outflow" as const,
  transaction_type: "expense" as const,
  excluded_from_totals: false,
  category_id: "groceries",
  categories: { name: "Groceries" },
  cleaned_description: "Checkers",
  ...over,
});

describe("summarise (README financial rules)", () => {
  it("counts only confirmed income as money in", () => {
    const totals = summarise([
      tx({ direction: "inflow", transaction_type: "income", amount_minor: 2500000 }),
      tx({ direction: "inflow", transaction_type: "unknown", amount_minor: 50000 }),
      tx({ direction: "inflow", transaction_type: "transfer", amount_minor: 100000 }),
    ]);
    expect(totals.moneyIn).toBe(2500000);
    expect(totals.unclassifiedIn).toBe(50000);
    expect(totals.transfers).toBe(100000);
  });

  it("subtracts refunds from spending instead of adding them to income", () => {
    const totals = summarise([tx({ amount_minor: 45000 }), tx({ direction: "inflow", transaction_type: "refund", amount_minor: 12000 })]);
    expect(totals.moneyOut).toBe(33000);
    expect(totals.moneyIn).toBe(0);
  });

  it("leaves out transfers and rows the user excluded", () => {
    const totals = summarise([
      tx({ amount_minor: 1000 }),
      tx({ transaction_type: "transfer", amount_minor: 99999 }),
      tx({ excluded_from_totals: true, amount_minor: 77777 }),
    ]);
    expect(totals.moneyOut).toBe(1000);
  });

  it("totals spending by category, biggest first, with uncategorised rows grouped", () => {
    const totals = summarise([
      tx({ amount_minor: 1000 }),
      tx({ amount_minor: 2000 }),
      tx({ category_id: "rent", categories: { name: "Rent" }, amount_minor: 8000 }),
      tx({ category_id: null, categories: null, amount_minor: 500 }),
    ]);
    expect(totals.categories).toEqual([
      { categoryId: "rent", key: null, name: "Rent", total: 8000, count: 1 },
      { categoryId: "groceries", key: null, name: "Groceries", total: 3000, count: 2 },
      { categoryId: null, key: null, name: "Uncategorised", total: 500, count: 1 },
    ]);
  });
});

describe("months", () => {
  it("shifts across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("knows the last day of the month", () => {
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-03-01", last: "2028-02-29" });
  });
});

describe("coverageFor", () => {
  const imp = (period_start: string, period_end: string, status = "imported") => ({ status, period_start, period_end });

  it("is whole when statements cover every day", () => {
    expect(coverageFor("2026-09", [imp("2026-09-01", "2026-09-30")]).coversWholeMonth).toBe(true);
  });

  it("joins back-to-back statements", () => {
    expect(coverageFor("2026-09", [imp("2026-09-16", "2026-10-15"), imp("2026-08-16", "2026-09-15")]).coversWholeMonth).toBe(true);
  });

  it("is partial when there is a gap", () => {
    const c = coverageFor("2026-09", [imp("2026-09-01", "2026-09-10"), imp("2026-09-15", "2026-09-30")]);
    expect(c).toMatchObject({ hasImports: true, coversWholeMonth: false, statementCount: 2 });
  });

  it("ignores imports that weren't confirmed", () => {
    expect(coverageFor("2026-09", [imp("2026-09-01", "2026-09-30", "cancelled")]).hasImports).toBe(false);
  });
});

describe("recurringCandidates", () => {
  it("finds a steady monthly payment in 3+ months", () => {
    const rows = ["2026-07-05", "2026-08-05", "2026-09-05"].map((d) =>
      tx({ transaction_date: d, cleaned_description: "Netflix.com Subscription", amount_minor: 19900, categories: { name: "Subscriptions" } }),
    );
    expect(recurringCandidates(rows)).toEqual([
      { description: "Netflix.com Subscription", typicalAmountMinor: 19900, months: 3, lastDate: "2026-09-05", categoryName: "Subscriptions" },
    ]);
  });

  it("skips merchants with very different amounts or too few months", () => {
    const rows = [
      tx({ transaction_date: "2026-07-01", cleaned_description: "Takealot", amount_minor: 1000 }),
      tx({ transaction_date: "2026-08-01", cleaned_description: "Takealot", amount_minor: 90000 }),
      tx({ transaction_date: "2026-09-01", cleaned_description: "Takealot", amount_minor: 5000 }),
      tx({ transaction_date: "2026-09-02", cleaned_description: "Gym", amount_minor: 30000 }),
    ];
    expect(recurringCandidates(rows)).toEqual([]);
  });
});
