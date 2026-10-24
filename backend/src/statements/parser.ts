/**
 * Generic South African bank statement parser.
 *
 * Works on lines split into columns. A transaction line starts with a date and
 * ends with one or two amounts (amount, then running balance). The running
 * balance is used to work out money in vs money out and to validate every row.
 */
import { cleanDescription } from "./clean.js";
import { findPeriod, parseDateToken, resolveDate, type PartialDate } from "./dates.js";
import { detectBank } from "./formats.js";
import { parseAmount, signedBalance, type ParsedAmount } from "./money.js";
import type { Line } from "./extractText.js";
import type { Direction } from "./categorise.js";

export type BalanceCheck = "ok" | "mismatch" | "none";

export type ParsedRow = {
  rowIndex: number;
  date: string;
  description: string;
  amountMinor: number;
  direction: Direction;
  balanceMinor: number | null;
  balanceCheck: BalanceCheck;
  extractionConfidence: number;
};

export type ValidationSummary = {
  parser: "generic-v1";
  has_warnings: boolean;
  detected_bank: string | null;
  row_count: number;
  balance_check: "passed" | "mismatch" | "unavailable";
  mismatched_rows: number;
  totals_check: "passed" | "failed" | "unavailable";
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
  period_source: "user" | "statement" | "transactions";
  rows_outside_period: number;
  warnings: string[];
};

export type ParseResult = {
  bankKey: string;
  period: { start: string; end: string };
  rows: ParsedRow[];
  validation: ValidationSummary;
};

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}

const OPENING_RE = /opening balance|balance brought forward|brought forward|previous balance|balance b\/f|bal b\/f/i;
const CLOSING_RE = /closing balance|balance carried forward|carried forward|balance c\/f|bal c\/f/i;
const HEADER_RE = /^(date|description|details|transaction|tran date|posting date|value date|balance|amount|debits?|credits?|fees?|page \d|continued|statement|account (number|no|type))\b/i;

type Draft = {
  date: PartialDate;
  descriptionParts: string[];
  amount: ParsedAmount;
  balance: ParsedAmount | null;
  continuationLines: number;
  page: number;
};

/** Tries the first one to three cells as a date ("01 Sep 2026" is sometimes split). */
function leadingDate(cells: string[]): { date: PartialDate; used: number } | null {
  for (let used = 1; used <= Math.min(3, cells.length); used++) {
    const date = parseDateToken(cells.slice(0, used).join(" "));
    if (date) {
      // Prefer the longest match (picks up the year when it's in its own cell).
      const longer = used < 3 && cells.length > used ? parseDateToken(cells.slice(0, used + 1).join(" ")) : null;
      return longer ? { date: longer, used: used + 1 } : { date, used };
    }
  }
  return null;
}

export function parseStatement(
  lines: Line[],
  options: { bankKey?: string; period?: { start: string; end: string }; today?: Date } = {},
): ParseResult {
  const today = options.today ?? new Date();
  const headText = lines
    .filter((l) => l.page <= 2)
    .map((l) => l.text)
    .join("\n");

  // Classify lines so bank names inside transactions ("Payment to Capitec") don't count.
  let firstTransactionSeen = false;
  const classified = lines.map((line) => {
    const texts = line.cells.map((c) => c.text);
    const isTransaction = Boolean(leadingDate(texts)) && texts.some((t) => parseAmount(t) !== null);
    if (isTransaction) firstTransactionSeen = true;
    return { text: line.text, isTransaction, isHeader: line.page === 1 && !firstTransactionSeen };
  });
  const detectedBank = detectBank(classified);
  const bankKey = options.bankKey && options.bankKey !== "auto" ? options.bankKey : (detectedBank ?? "generic");
  const statementPeriod = findPeriod(headText);
  const warnings: string[] = [];

  // Which sign convention does this statement use for unmarked amounts?
  let crMarkers = 0;
  let minusMarkers = 0;
  for (const line of lines) {
    for (const cell of line.cells) {
      if (/\bcr$/i.test(cell.text) && parseAmount(cell.text)) crMarkers++;
      if (/^-/.test(cell.text) && parseAmount(cell.text)) minusMarkers++;
    }
  }
  // FNB-style: credits marked "Cr", debits unmarked. Capitec-style: debits "-", credits unmarked.
  const unmarkedDirection: Direction | null = crMarkers > minusMarkers ? "outflow" : minusMarkers > 0 ? "inflow" : null;

  let opening: number | null = null;
  let closing: number | null = null;
  const drafts: Draft[] = [];

  for (const line of lines) {
    const texts = line.cells.map((c) => c.text);
    const amountsInLine = texts.map(parseAmount);

    if (OPENING_RE.test(line.text)) {
      const last = [...amountsInLine].reverse().find(Boolean);
      if (last && opening === null) opening = signedBalance(last);
      continue;
    }
    if (CLOSING_RE.test(line.text)) {
      const last = [...amountsInLine].reverse().find(Boolean);
      if (last) closing = signedBalance(last);
      continue;
    }

    const dated = leadingDate(texts);
    if (dated) {
      const rest = texts.slice(dated.used);
      const amounts: ParsedAmount[] = [];
      const description: string[] = [];
      for (const text of rest) {
        const amount = parseAmount(text);
        if (amount && (amounts.length > 0 || description.length > 0)) amounts.push(amount);
        else if (amounts.length === 0) description.push(text);
        // text after the amounts (e.g. a fee column label) is ignored
      }
      if (amounts.length === 0 || description.length === 0) continue;

      drafts.push({
        date: dated.date,
        descriptionParts: description,
        amount: amounts.length >= 2 ? amounts[amounts.length - 2]! : amounts[0]!,
        balance: amounts.length >= 2 ? amounts[amounts.length - 1]! : null,
        continuationLines: 0,
        page: line.page,
      });
      continue;
    }

    // A wrapped description line belongs to the transaction above it.
    const last = drafts.at(-1);
    const looksLikeText = amountsInLine.every((a) => a === null) && line.text.length <= 120;
    if (last && looksLikeText && last.page === line.page && last.continuationLines < 2 && !HEADER_RE.test(line.text)) {
      last.descriptionParts.push(line.text);
      last.continuationLines++;
    } else if (last) {
      last.continuationLines = 2; // stop attaching after a gap, header or totals line
    }
  }

  if (drafts.length === 0) {
    throw new StatementParseError(
      "We couldn't find any transactions in this PDF. Check it's a bank statement (not a summary or tax certificate), or choose your bank manually.",
    );
  }

  // ---- Statement period and years ----
  let period = options.period ?? statementPeriod ?? null;
  let periodSource: ValidationSummary["period_source"] = options.period ? "user" : statementPeriod ? "statement" : "transactions";
  const fallbackYear = today.getUTCFullYear();
  if (drafts.some((d) => !d.date.year) && !period) {
    warnings.push("The statement dates have no year, so we assumed this year. Check the statement period.");
  }

  // ---- Direction and balance validation ----
  const rows: ParsedRow[] = [];
  let previous = opening;
  let mismatched = 0;
  let checked = 0;
  for (const draft of drafts) {
    const date = resolveDate(draft.date, period?.end ?? null, fallbackYear);
    if (!date) continue;

    const balance = draft.balance ? signedBalance(draft.balance) : null;
    let direction: Direction;
    let check: BalanceCheck = "none";

    if (previous !== null && balance !== null && Math.abs(balance - previous) === draft.amount.minor) {
      direction = balance > previous ? "inflow" : "outflow";
      check = "ok";
    } else {
      if (draft.amount.marker === 1) direction = "inflow";
      else if (draft.amount.marker === -1) direction = "outflow";
      else direction = unmarkedDirection ?? "outflow";
      if (previous !== null && balance !== null) check = "mismatch";
    }

    if (check !== "none") checked++;
    if (check === "mismatch") mismatched++;
    if (balance !== null) previous = balance;

    const confidence =
      check === "ok" ? 0.98 : check === "mismatch" ? 0.4 : draft.amount.marker !== 0 ? 0.8 : unmarkedDirection ? 0.7 : 0.5;

    rows.push({
      rowIndex: rows.length,
      date,
      description: cleanDescription(draft.descriptionParts.join(" ")),
      amountMinor: draft.amount.minor,
      direction,
      balanceMinor: balance,
      balanceCheck: check,
      extractionConfidence: confidence,
    });
  }

  if (!period) {
    const dates = rows.map((r) => r.date).sort();
    period = { start: dates[0]!, end: dates.at(-1)! };
    periodSource = "transactions";
  }

  const outside = rows.filter((r) => r.date < period.start || r.date > period.end).length;
  if (outside > 0) warnings.push(`${outside} transaction(s) fall outside the statement period.`);

  const balanceCheck: ValidationSummary["balance_check"] =
    checked === 0 ? "unavailable" : mismatched === 0 ? "passed" : "mismatch";
  if (balanceCheck === "mismatch") {
    warnings.push(`${mismatched} row(s) don't match the running balance. Check their amounts and whether they're money in or out.`);
  }
  if (balanceCheck === "unavailable") {
    warnings.push("This statement has no running balance we could read, so money in/out could not be double-checked.");
  }

  let totalsCheck: ValidationSummary["totals_check"] = "unavailable";
  if (opening !== null && closing !== null) {
    const net = rows.reduce((sum, r) => sum + (r.direction === "inflow" ? r.amountMinor : -r.amountMinor), 0);
    totalsCheck = opening + net === closing ? "passed" : "failed";
    if (totalsCheck === "failed") {
      warnings.push("Opening balance plus transactions doesn't equal the closing balance. Some rows may be missing.");
    }
  }

  if (options.bankKey && options.bankKey !== "auto" && detectedBank && detectedBank !== options.bankKey) {
    warnings.push("This statement looks like it's from a different bank than the one you chose.");
  }

  return {
    bankKey,
    period,
    rows,
    validation: {
      parser: "generic-v1",
      has_warnings: warnings.length > 0,
      detected_bank: detectedBank,
      row_count: rows.length,
      balance_check: balanceCheck,
      mismatched_rows: mismatched,
      totals_check: totalsCheck,
      opening_balance_minor: opening,
      closing_balance_minor: closing,
      period_source: periodSource,
      rows_outside_period: outside,
      warnings,
    },
  };
}
