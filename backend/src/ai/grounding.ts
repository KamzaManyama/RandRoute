/**
 * Grounding check: every rand amount and percentage in an AI answer must be
 * one the app sent it. The model may round to the nearest rand or whole
 * percent, but it may not invent, add up or recalculate figures. Text that
 * fails is dropped before anyone sees it.
 */

export type AllowedNumbers = { amounts: Set<number>; percents: number[] };

const RAND_RE = /R\s?(\d{1,3}(?:[  ,]\d{3})+|\d+)(?:[.,](\d{2}))?(?!\d)/g;
const RAND_SHORTHAND_RE = /R\s?\d+(?:[.,]\d+)?\s?(?:k|m|mil|million|thousand)\b/i;
const PERCENT_RE = /(-?\d+(?:[.,]\d+)?)\s?(?:%|percent\b)/gi;

function randToCents(whole: string, cents: string | undefined): number {
  return Number(whole.replace(/[  ,]/g, "")) * 100 + Number(cents ?? "0");
}

/** Collects every amount and percentage in the data we sent. */
export function allowedNumbers(input: unknown): AllowedNumbers {
  const amounts = new Set<number>();
  const percents: number[] = [];
  const visit = (value: unknown, key = "") => {
    if (typeof value === "string") {
      for (const m of value.matchAll(RAND_RE)) amounts.add(randToCents(m[1]!, m[2]));
      for (const m of value.matchAll(PERCENT_RE)) percents.push(Math.abs(Number(m[1]!.replace(",", "."))));
    } else if (typeof value === "number" && /percent/i.test(key)) {
      percents.push(Math.abs(value));
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(input);
  // Fixed percentages the app itself uses: the 10% savings rule of thumb, the
  // 20% "good savings" level, and the 10% / 25% trims in savingOpportunities.
  percents.push(10, 20, 25);
  return { amounts, percents };
}

export type GroundingResult = { ok: boolean; checked: number; ungrounded: string[] };

export function checkGrounding(text: string, allowed: AllowedNumbers): GroundingResult {
  const ungrounded: string[] = [];
  let checked = 0;

  if (RAND_SHORTHAND_RE.test(text)) ungrounded.push(text.match(RAND_SHORTHAND_RE)![0]);

  for (const m of text.matchAll(RAND_RE)) {
    checked++;
    const cents = randToCents(m[1]!, m[2]);
    const exact = allowed.amounts.has(cents);
    // "about R1 250" for R1 249.50 is fine: rounding to the nearest rand.
    const rounded = !m[2] && [...allowed.amounts].some((a) => Math.round(a / 100) * 100 === cents);
    if (!exact && !rounded) ungrounded.push(m[0]);
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    checked++;
    const value = Math.abs(Number(m[1]!.replace(",", ".")));
    const ok = allowed.percents.some((p) => p === value || Math.round(p) === value || Math.round(p * 10) / 10 === value);
    if (!ok) ungrounded.push(m[0]);
  }
  return { ok: ungrounded.length === 0, checked, ungrounded };
}

/** Advice we never show, whatever the model says. */
const OFF_LIMITS_RE =
  /\b(crypto(currency)?|bitcoin|forex|day[- ]?trad\w*|stock tips?|guaranteed (returns?|profits?)|get rich|buy (shares|stocks)|payday loan|take (out )?a loan|current balance)\b/i;

export function isOffLimits(text: string): boolean {
  return OFF_LIMITS_RE.test(text);
}
