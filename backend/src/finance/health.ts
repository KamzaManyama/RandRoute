/**
 * Savings rate and a simple financial-health level, worked out by the app
 * with fixed, explainable rules. AI never decides these; it may only explain
 * them. Every reason carries the figure it was based on.
 *
 * This is budgeting guidance from the user's own statements, not a credit
 * score or financial advice.
 */
import type { Coverage, LimitStatus } from "./rules.js";

export type HealthLevel = "healthy" | "watch" | "at_risk" | "not_enough_data";
export type ReasonTone = "good" | "warning" | "risk" | "info";
export type HealthReason = { code: string; tone: ReasonTone; text: string };

export type Health = {
  level: HealthLevel;
  /** True when the month isn't fully covered by statements, so the level may change. */
  provisional: boolean;
  reasons: HealthReason[];
};

/** Thresholds, in one place so they're easy to review. */
export const HEALTH_RULES = {
  /** Savings rate (share of income left after spending) below this is a warning. */
  lowSavingsBp: 1000, // 10%
  /** At or above this is called out as a strength. */
  goodSavingsBp: 2000, // 20%
  /** Loan and credit repayments above this share of income are a risk. */
  highDebtBp: 3000, // 30%
  /** Spending up by at least this much vs last month is a warning. */
  spendingJumpPercent: 20,
  /** Bank fees above this share of spending (and at least R100) are a warning. */
  highFeesBp: 200, // 2%
  minFeesMinor: 10_000,
  /** This many budget categories over their limit is a risk, fewer is a warning. */
  manyOverBudget: 3,
} as const;

/** Formats cents as "R1 250.00" — the same style used in AI prompts. */
export function formatRand(minor: number): string {
  const negative = minor < 0;
  const [whole, cents] = (Math.abs(minor) / 100).toFixed(2).split(".") as [string, string];
  return `${negative ? "-" : ""}R${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${cents}`;
}

/**
 * Share of income not spent, in basis points (1 bp = 0.01%), using integer
 * maths. null when there is no income to compare against.
 */
export function savingsRateBp(incomeMinor: number, spendingMinor: number): number | null {
  if (incomeMinor <= 0) return null;
  return Math.round(((incomeMinor - spendingMinor) * 10_000) / incomeMinor);
}

export function bpToPercent(bp: number | null): number | null {
  return bp === null ? null : Math.round(bp) / 100;
}

export type HealthInput = {
  coverage: Pick<Coverage, "hasImports" | "coversWholeMonth">;
  incomeMinor: number;
  spendingMinor: number;
  unclassifiedInMinor: number;
  feesMinor: number;
  debtRepaymentsMinor: number;
  spendingChangePercent: number | null;
  budgetStatuses: LimitStatus[];
};

const pct = (bp: number) => `${(bp / 100).toFixed(1).replace(/\.0$/, "")}%`;

export function assessHealth(input: HealthInput): Health {
  const reasons: HealthReason[] = [];
  const provisional = !input.coverage.coversWholeMonth;

  if (!input.coverage.hasImports) {
    return {
      level: "not_enough_data",
      provisional: true,
      reasons: [{ code: "no_statements", tone: "info", text: "Import a statement for this month to see your money health." }],
    };
  }
  if (input.incomeMinor <= 0) {
    reasons.push(
      input.unclassifiedInMinor > 0
        ? {
            code: "income_unmarked",
            tone: "info",
            text: `${formatRand(input.unclassifiedInMinor)} came in but isn't marked as income yet. Mark your income to see your savings rate.`,
          }
        : { code: "no_income", tone: "info", text: "No income was found for this month, so we can't work out a savings rate." },
    );
    return { level: "not_enough_data", provisional, reasons };
  }

  const rate = savingsRateBp(input.incomeMinor, input.spendingMinor)!;
  const net = input.incomeMinor - input.spendingMinor;

  if (net < 0) {
    reasons.push({ code: "overspent", tone: "risk", text: `You spent ${formatRand(-net)} more than came in.` });
  } else if (rate < HEALTH_RULES.lowSavingsBp) {
    reasons.push({ code: "low_savings", tone: "warning", text: `Only ${pct(rate)} of your income was left after spending (aim for at least 10%).` });
  } else if (rate >= HEALTH_RULES.goodSavingsBp) {
    reasons.push({ code: "good_savings", tone: "good", text: `${pct(rate)} of your income was left after spending.` });
  } else {
    reasons.push({ code: "ok_savings", tone: "good", text: `${pct(rate)} of your income was left after spending.` });
  }

  // Floor, so a threshold is only crossed once it is really reached.
  const debtBp = Math.floor((input.debtRepaymentsMinor * 10_000) / input.incomeMinor);
  if (debtBp >= HEALTH_RULES.highDebtBp) {
    reasons.push({
      code: "high_debt",
      tone: "risk",
      text: `Loan and credit repayments took ${pct(debtBp)} of your income (${formatRand(input.debtRepaymentsMinor)}).`,
    });
  }

  const over = input.budgetStatuses.filter((s) => s === "exceeded").length;
  if (over >= HEALTH_RULES.manyOverBudget) {
    reasons.push({ code: "many_over_budget", tone: "risk", text: `${over} budget categories are over their limit.` });
  } else if (over > 0) {
    reasons.push({ code: "over_budget", tone: "warning", text: `${over} budget categor${over === 1 ? "y is" : "ies are"} over the limit.` });
  } else if (input.budgetStatuses.length > 0) {
    reasons.push({ code: "budgets_on_track", tone: "good", text: "All your budget categories are within their limits." });
  }

  if (input.spendingChangePercent !== null) {
    if (input.spendingChangePercent >= HEALTH_RULES.spendingJumpPercent) {
      reasons.push({ code: "spending_up", tone: "warning", text: `Spending is up ${input.spendingChangePercent}% on last month.` });
    } else if (input.spendingChangePercent <= -10) {
      reasons.push({ code: "spending_down", tone: "good", text: `Spending is down ${-input.spendingChangePercent}% on last month.` });
    }
  }

  if (input.spendingMinor > 0) {
    const feesBp = Math.floor((input.feesMinor * 10_000) / input.spendingMinor);
    if (feesBp >= HEALTH_RULES.highFeesBp && input.feesMinor >= HEALTH_RULES.minFeesMinor) {
      reasons.push({ code: "high_fees", tone: "warning", text: `Bank fees came to ${formatRand(input.feesMinor)} (${pct(feesBp)} of your spending).` });
    }
  }

  if (input.unclassifiedInMinor > 0) {
    reasons.push({
      code: "income_unmarked",
      tone: "info",
      text: `${formatRand(input.unclassifiedInMinor)} came in but isn't marked as income, so it isn't counted.`,
    });
  }
  if (provisional) {
    reasons.push({ code: "partial_month", tone: "info", text: "Your statements don't cover the whole month yet, so this may change." });
  }

  const level: HealthLevel = reasons.some((r) => r.tone === "risk")
    ? "at_risk"
    : reasons.some((r) => r.tone === "warning")
      ? "watch"
      : "healthy";
  return { level, provisional, reasons };
}
