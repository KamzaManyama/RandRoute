/**
 * Money helpers. Amounts are always whole cents (integers) — never floats.
 */

export type ParsedAmount = {
  /** Absolute value in cents. */
  minor: number;
  /** Sign written on the statement: -1 for "-", "Dr"; +1 for "Cr"; 0 when unmarked. */
  marker: -1 | 0 | 1;
};

// e.g. "1 234.56", "1,234.56", "R1234.56", "-45.00", "45.00-", "1 234.56 Cr", "(45.00)"
const AMOUNT_RE =
  /^(?<lead>-|\()?\s*(?:R|ZAR)?\s*(?<int>\d{1,3}(?:[ , ]\d{3})+|\d+)(?<dec>[.,]\d{2})\s*(?<close>\))?\s*(?<trail>-|cr|dr)?$/i;

export function parseAmount(text: string): ParsedAmount | null {
  const match = AMOUNT_RE.exec(text.trim());
  if (!match?.groups) return null;
  const { lead, int, dec, close, trail } = match.groups;
  if ((lead === "(") !== Boolean(close)) return null;

  const digits = `${int!.replace(/[ , ]/g, "")}${dec!.slice(1)}`;
  const minor = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(minor)) return null;

  let marker: ParsedAmount["marker"] = 0;
  const t = trail?.toLowerCase();
  if (lead === "-" || lead === "(" || t === "-" || t === "dr") marker = -1;
  else if (t === "cr") marker = 1;
  return { minor, marker };
}

export function isAmount(text: string): boolean {
  return parseAmount(text) !== null;
}

/** Signed cents for balances: "Cr"/unmarked = positive, "Dr"/"-" = negative (overdrawn). */
export function signedBalance(amount: ParsedAmount): number {
  return amount.marker === -1 ? -amount.minor : amount.minor;
}
