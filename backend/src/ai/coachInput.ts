/**
 * The ONLY data an AI request may see.
 *
 * Built from figures the app already calculated (finance/insights.ts) and
 * checked against a strict schema: any field not listed here is rejected, so
 * transaction descriptions, dates of individual transactions, account
 * details, names and emails can't slip through by accident.
 */
import { z } from "zod";
import type { MonthInsights } from "../finance/insights.js";
import { formatRand } from "../finance/health.js";

const rand = z.string().regex(/^-?R\d{1,3}( \d{3})*\.\d{2}$/, "Amounts must be formatted rand strings.");
const label = z.string().min(1).max(60);
const percent = z.number().finite().nullable();

export const CoachInputSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    currency: z.literal("ZAR"),
    coverage: z.enum(["whole_month", "partial_month", "none"]),
    income: rand,
    incomeBreakdown: z.object({ salary: rand, sideIncome: rand, other: rand }).strict(),
    incomeNotYetMarked: rand,
    spending: rand,
    net: rand,
    savingsRatePercent: percent,
    topCategories: z.array(z.object({ category: label, amount: rand, sharePercent: percent }).strict()).max(5),
    monthOverMonth: z
      .object({
        available: z.boolean(),
        spendingChangePercent: percent,
        biggestChanges: z
          .array(z.object({ category: label, thisMonth: rand, lastMonth: rand, changePercent: percent }).strict())
          .max(5),
      })
      .strict(),
    unusualIncreases: z.array(z.object({ category: label, thisMonth: rand, usualAverage: rand }).strict()).max(5),
    budget: z
      .object({
        hasBudget: z.boolean(),
        categoriesOverLimit: z.number().int().min(0),
        categories: z
          .array(z.object({ category: label, limit: rand, spent: rand, status: z.enum(["on_track", "near_limit", "reached", "exceeded"]) }).strict())
          .max(20),
      })
      .strict(),
    risk: z
      .object({
        level: z.enum(["healthy", "watch", "at_risk", "not_enough_data"]),
        provisional: z.boolean(),
        reasons: z.array(z.string().max(200)).max(10),
      })
      .strict(),
    debitOrders: z.object({ total: rand, count: z.number().int().min(0) }).strict(),
    goals: z
      .object({
        expectedIncome: rand.nullable(),
        savingsTarget: rand.nullable(),
        monthlySpendingTarget: rand.nullable(),
        savingsTargetMet: z.boolean().nullable(),
      })
      .strict(),
    savingOpportunities: z
      .object({
        ifYouTrim: z
          .array(
            z
              .object({
                category: label,
                spentThisMonth: rand,
                save10PercentPerMonth: rand,
                save25PercentPerMonth: rand,
                save25PercentPerYear: rand,
              })
              .strict(),
          )
          .max(5),
        overBudget: z.array(z.object({ category: label, overBy: rand }).strict()).max(20),
      })
      .strict(),
    limitations: z.array(z.string().max(200)).max(10),
  })
  .strict();

export type CoachInput = z.infer<typeof CoachInputSchema>;

/**
 * Category names can be user-made. Strip anything that looks like personal
 * data (emails, long digit runs) before it leaves the server.
 */
export function safeLabel(text: string): string {
  const cleaned = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\d[\d\s-]{3,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || "Category";
}

const r = formatRand;
const rOrNull = (minor: number | null) => (minor === null ? null : r(minor));

export function buildCoachInput(insights: MonthInsights): CoachInput {
  const t = insights.totals;
  const input = {
    month: insights.month,
    currency: "ZAR" as const,
    coverage: insights.coverage.coversWholeMonth ? "whole_month" : insights.coverage.hasImports ? "partial_month" : "none",
    income: r(t.moneyInMinor),
    incomeBreakdown: { salary: r(t.income.salary), sideIncome: r(t.income.side), other: r(t.income.other) },
    incomeNotYetMarked: r(t.unclassifiedInMinor),
    spending: r(t.moneyOutMinor),
    net: r(t.netMinor),
    savingsRatePercent: insights.savingsRate.percent,
    topCategories: insights.topCategories.map((c) => ({ category: safeLabel(c.name), amount: r(c.totalMinor), sharePercent: c.sharePercent })),
    monthOverMonth: {
      available: insights.comparison.available,
      spendingChangePercent: t.moneyOutChangePercent,
      biggestChanges: insights.changes.slice(0, 5).map((c) => ({
        category: safeLabel(c.name),
        thisMonth: r(c.totalMinor),
        lastMonth: r(c.previousMinor),
        changePercent: c.changePercent,
      })),
    },
    unusualIncreases: insights.unusual.slice(0, 5).map((u) => ({ category: safeLabel(u.name), thisMonth: r(u.totalMinor), usualAverage: r(u.averageMinor) })),
    budget: {
      hasBudget: insights.budget.hasBudget,
      categoriesOverLimit: insights.budget.overCount,
      categories: insights.budget.limits.slice(0, 20).map((l) => ({ category: safeLabel(l.name), limit: r(l.limitMinor), spent: r(l.spentMinor), status: l.status })),
    },
    risk: {
      level: insights.health.level,
      provisional: insights.health.provisional,
      reasons: insights.health.reasons.map((x) => x.text),
    },
    debitOrders: { total: r(t.debitOrders.total), count: t.debitOrders.count },
    goals: {
      expectedIncome: rOrNull(insights.goals.expectedIncomeMinor),
      savingsTarget: rOrNull(insights.goals.savingsTargetMinor),
      monthlySpendingTarget: rOrNull(insights.goals.monthlySpendingTargetMinor),
      savingsTargetMet: insights.goals.savingsTargetMet,
    },
    savingOpportunities: {
      ifYouTrim: insights.savings.trims.map((x) => ({
        category: safeLabel(x.name),
        spentThisMonth: r(x.spentMinor),
        save10PercentPerMonth: r(x.save10PercentMinor),
        save25PercentPerMonth: r(x.save25PercentMinor),
        save25PercentPerYear: r(x.save25PercentYearlyMinor),
      })),
      overBudget: insights.savings.overBudget.map((o) => ({ category: safeLabel(o.name), overBy: r(o.overByMinor) })),
    },
    limitations: insights.limitations,
  };
  // Throws if anything outside the schema was added — a bug, never sent.
  return CoachInputSchema.parse(input);
}
