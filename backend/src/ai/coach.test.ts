import { describe, expect, it } from "vitest";
import { allowedNumbers, checkGrounding, isOffLimits } from "./grounding.js";
import { CoachInputSchema, safeLabel, type CoachInput } from "./coachInput.js";
import { validateCoachAnswer } from "./coach.js";

const input: CoachInput = {
  month: "2026-09",
  currency: "ZAR",
  coverage: "whole_month",
  income: "R25 000.00",
  incomeBreakdown: { salary: "R24 000.00", sideIncome: "R1 000.00", other: "R0.00" },
  incomeNotYetMarked: "R0.00",
  spending: "R18 249.50",
  net: "R6 750.50",
  savingsRatePercent: 27,
  topCategories: [{ category: "Groceries", amount: "R4 120.00", sharePercent: 23 }],
  monthOverMonth: { available: true, spendingChangePercent: 12.5, biggestChanges: [] },
  unusualIncreases: [],
  budget: { hasBudget: false, categoriesOverLimit: 0, categories: [] },
  risk: { level: "healthy", provisional: false, reasons: ["27% of your income was left after spending."] },
  debitOrders: { total: "R3 400.00", count: 4 },
  goals: { expectedIncome: null, savingsTarget: "R5 000.00", monthlySpendingTarget: null, savingsTargetMet: true },
  savingOpportunities: {
    ifYouTrim: [{ category: "Eating out", spentThisMonth: "R1 600.00", save10PercentPerMonth: "R160.00", save25PercentPerMonth: "R400.00", save25PercentPerYear: "R4 800.00" }],
    overBudget: [],
  },
  limitations: [],
};

describe("AI input safety", () => {
  it("accepts only the whitelisted summary fields", () => {
    expect(CoachInputSchema.safeParse(input).success).toBe(true);
    // Anything extra — like raw descriptions — is rejected outright.
    expect(CoachInputSchema.safeParse({ ...input, transactions: [{ description: "Checkers Sandton" }] }).success).toBe(false);
    expect(CoachInputSchema.safeParse({ ...input, topCategories: [{ category: "Groceries", amount: "R1.00", sharePercent: 1, description: "x" }] }).success).toBe(false);
  });

  it("only allows amounts as formatted rand strings, never raw numbers", () => {
    expect(CoachInputSchema.safeParse({ ...input, income: 2500000 }).success).toBe(false);
    expect(CoachInputSchema.safeParse({ ...input, income: "25000" }).success).toBe(false);
  });

  it("strips emails and long numbers from user-made category names", () => {
    expect(safeLabel("Pay jane@example.com back")).toBe("Pay back");
    expect(safeLabel("Loan 6200 0000 1234")).toBe("Loan");
    expect(safeLabel("12345678")).toBe("Category");
    expect(safeLabel("x".repeat(80))).toHaveLength(60);
  });
});

describe("grounding check", () => {
  const allowed = allowedNumbers(input);

  it("accepts figures copied from the data, in any common format", () => {
    expect(checkGrounding("You spent R18 249.50 and kept R6 750.50.", allowed).ok).toBe(true);
    expect(checkGrounding("Groceries were R4,120.00 (23%).", allowed).ok).toBe(true);
    expect(checkGrounding("Trimming eating out by 25% saves R400.00 a month, R4 800.00 a year.", allowed).ok).toBe(true);
  });

  it("allows rounding to the nearest rand or whole percent", () => {
    expect(checkGrounding("About R18 250 went out.", allowed).ok).toBe(true);
    expect(checkGrounding("Spending is up about 13%.", allowed).ok).toBe(true);
  });

  it("rejects invented, summed or recalculated figures", () => {
    const result = checkGrounding("You spent R9 999.00 on food, 61% of everything.", allowed);
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toEqual(["R9 999.00", "61%"]);
    // R4 120 + R1 600 = R5 720 is a sum the app never sent
    expect(checkGrounding("Food cost R5 720.00 in total.", allowed).ok).toBe(false);
  });

  it("rejects shorthand like R18k that can't be checked", () => {
    expect(checkGrounding("You spent about R18k.", allowed).ok).toBe(false);
  });

  it("blocks off-limits advice", () => {
    expect(isOffLimits("Consider putting spare cash into Bitcoin.")).toBe(true);
    expect(isOffLimits("Your current balance is healthy.")).toBe(true);
    expect(isOffLimits("Cook at home twice more each week.")).toBe(false);
  });
});

describe("validateCoachAnswer", () => {
  const answer = {
    summary: "R25 000.00 came in and R18 249.50 went out, leaving 27%.",
    positives: ["You met your savings target of R5 000.00.", "Side income added R1 000.00.", "Debit orders were steady."],
    concerns: ["Groceries were 23% of spending.", "Spending is up 12.5% on last month.", "You bought crypto with R500.00."],
    actions: ["Trim eating out by 25% to save R400.00 a month.", "Check your 4 debit orders.", "Set a grocery budget."],
    motivation: "Every small step counts.",
  };

  it("keeps grounded points and drops the rest", () => {
    const result = validateCoachAnswer(answer, input)!;
    expect(result.answer.concerns).toEqual(["Groceries were 23% of spending.", "Spending is up 12.5% on last month."]);
    expect(result.verification.pointsRemoved).toBe(1);
    expect(result.answer.positives).toHaveLength(3);
  });

  it("returns nothing when the summary can't be verified", () => {
    expect(validateCoachAnswer({ ...answer, summary: "You spent R30 000.00 this month." }, input)).toBeNull();
  });

  it("returns nothing when a whole section is unusable", () => {
    expect(validateCoachAnswer({ ...answer, actions: ["Spend R1.23 less.", "Save R9.99."] }, input)).toBeNull();
  });

  it("replaces a motivation line that sneaks in numbers", () => {
    const result = validateCoachAnswer({ ...answer, motivation: "You'll have R1 000 000.00 soon!" }, input)!;
    expect(result.answer.motivation).not.toMatch(/R\d/);
  });
});
