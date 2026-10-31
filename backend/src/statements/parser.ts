/**
 * South African bank statement parser.
 *
 * 1. Lines are split into cells (extractText.ts).
 * 2. A table header, if present, tells us which column each amount is in
 *    (layout.ts) — Debit vs Credit, Fee, Balance.
 * 3. A transaction line has a date and at least one amount. Wrapped
 *    description lines are joined to the line above.
 * 4. The running balance decides money in vs money out wherever it can, and
 *    every row is checked against it. Columns, "Cr"/"Dr"/"-" markers and the
 *    bank's sign convention are fall-backs, each with lower confidence.
 * 5. Rows get validation flags so the review screen can show exactly what to
 *    check. Nothing is dropped silently: skipped lines are counted and reported.
 */
import { cleanDescription, normaliseForMatch } from "./clean.js";
import { findPeriod, parseDateToken, resolveDate, type PartialDate } from "./dates.js";
import { detectBank, getFormat, type BankFormat } from "./formats.js";
import { parseAmount, signedBalance, type ParsedAmount } from "./money.js";
import { amountColumnFor, detectHeader, isInColumn, type ColumnRole, type Layout } from "./layout.js";
import { detectChannel, type Channel } from "./channel.js";
import type { Line } from "./extractText.js";
import type { Direction } from "./categorise.js";

export type BalanceCheck = "ok" | "mismatch" | "none";

export type RowFlag =
  | "balance_mismatch" // amount/direction disagrees with the running balance
  | "direction_guessed" // no balance or column to confirm money in vs out
  | "outside_period" // date falls outside the statement period
  | "future_date" // dated after today
  | "large_amount" // unusually large compared with the rest of the statement
  | "repeat_in_statement" // same date, amount and description appears more than once
  | "fee_split" // fee taken from the bank's fee column on the same line
  | "fee_unverified"; // fee column amount we couldn't confirm against a balance

export const ROW_FLAG_LABELS: Record<RowFlag, string> = {
  balance_mismatch: "Doesn't match the running balance",
  direction_guessed: "Money in/out couldn't be double-checked",
  outside_period: "Outside the statement period",
  future_date: "Dated in the future",
  large_amount: "Unusually large amount",
  repeat_in_statement: "Appears more than once on this statement",
  fee_split: "Fee from the bank's fee column",
  fee_unverified: "Fee couldn't be checked against the balance",
};

/** Flags that mean a person must look at the row before it can be imported. */
export const BLOCKING_FLAGS: ReadonlySet<RowFlag> = new Set([
  "balance_mismatch",
  "direction_guessed",
  "outside_period",
  "future_date",
  "large_amount",
  "repeat_in_statement",
  "fee_unverified",
]);

export type ParsedRow = {
  rowIndex: number;
  date: string;
  description: string;
  amountMinor: number;
  direction: Direction;
  balanceMinor: number | null;
  balanceCheck: BalanceCheck;
  extractionConfidence: number;
  channel: Channel;
  flags: RowFlag[];
};

export type ValidationSummary = {
  parser: "column-v2";
  has_warnings: boolean;
  detected_bank: string | null;
  row_count: number;
  rows_skipped: number;
  layout_detected: boolean;
  newest_first: boolean;
  balance_check: "passed" | "mismatch" | "unavailable";
  mismatched_rows: number;
  totals_check: "passed" | "failed" | "unavailable";
  column_totals_check: "passed" | "failed" | "unavailable";
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
  period_source: "user" | "statement" | "transactions";
  rows_outside_period: number;
  fee_rows: number;
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
const TOTAL_OUT_RE = /total (debits?|money out|withdrawals|payments|debit amount)/i;
const TOTAL_IN_RE = /total (credits?|money in|deposits|receipts|credit amount)/i;
/** Lines with a date and an amount that are NOT transactions. */
const NOT_TRANSACTION_RE =
  /statement date|date of issue|issue date|payment due|due date|available balance|credit limit|minimum (payment|amount) due|interest rate|overdraft limit|vat registration/i;
const HEADER_RE =
  /^(date|description|details|transaction|tran date|posting date|value date|balance|amount|debits?|credits?|fees?|page \d|continued|statement|account (number|no|type))\b/i;

/** Above this many rand AND this many times the median, a row is flagged as unusually large. */
const LARGE_MIN_MINOR = 5_000_000; // R50 000
const LARGE_FACTOR = 20;

type AmountCell = { amount: ParsedAmount; role: ColumnRole | null };

type Draft = {
  date: PartialDate;
  rawDescription: string[];
  amounts: AmountCell[];
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

/** For layouts where the date column isn't first (e.g. Standard Bank "Details … Date … Balance"). */
function dateInColumn(line: Line, layout: Layout | null): { date: PartialDate; index: number } | null {
  if (!layout || layout.columns[0]?.role === "date") return null;
  for (let i = 0; i < line.cells.length; i++) {
    const cell = line.cells[i]!;
    if (!isInColumn(layout, cell, "date")) continue;
    const date = parseDateToken(cell.text);
    if (date) return { date, index: i };
  }
  return null;
}

const dateKey = (d: PartialDate) => (d.year ?? 0) * 400 + d.month * 32 + d.day;

export function parseStatement(
  lines: Line[],
  options: { bankKey?: string; period?: { start: string; end: string }; today?: Date } = {},
): ParseResult {
  const today = options.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const headText = lines
    .filter((l) => l.page <= 2)
    .map((l) => l.text)
    .join("\n");

  // ---- Which bank? (bank names inside transactions don't count) ----
  let firstTransactionSeen = false;
  const classified = lines.map((line) => {
    const texts = line.cells.map((c) => c.text);
    const hasDate = Boolean(leadingDate(texts)) || texts.slice(0, 8).some((t) => parseDateToken(t));
    const isTransaction = hasDate && texts.some((t) => parseAmount(t) !== null);
    if (isTransaction) firstTransactionSeen = true;
    return { text: line.text, isTransaction, isHeader: line.page === 1 && !firstTransactionSeen };
  });
  const detectedBank = detectBank(classified);
  const bankKey = options.bankKey && options.bankKey !== "auto" ? options.bankKey : (detectedBank ?? "generic");
  const profile: BankFormat = getFormat(bankKey);
  const statementPeriod = findPeriod(headText);
  const warnings: string[] = [];

  // ---- Pass 1: lines → drafts ----
  let layout: Layout | null = null;
  let layoutSeen = false;
  let opening: number | null = null;
  let closing: number | null = null;
  let totalOut: number | null = null;
  let totalIn: number | null = null;
  const drafts: Draft[] = [];

  for (const line of lines) {
    const header = detectHeader(line);
    if (header) {
      layout = header;
      layoutSeen = true;
      const last = drafts.at(-1);
      if (last) last.continuationLines = 2;
      continue;
    }

    const texts = line.cells.map((c) => c.text);
    const lastAmount = () => {
      const found = [...texts].reverse().map(parseAmount).find(Boolean);
      return found ?? null;
    };

    if (OPENING_RE.test(line.text)) {
      const a = lastAmount();
      if (a && opening === null) opening = signedBalance(a);
      continue;
    }
    if (CLOSING_RE.test(line.text)) {
      const a = lastAmount();
      if (a) closing = signedBalance(a);
      continue;
    }
    if (TOTAL_OUT_RE.test(line.text) && !leadingDate(texts)) {
      const a = lastAmount();
      if (a) totalOut = a.minor;
      continue;
    }
    if (TOTAL_IN_RE.test(line.text) && !leadingDate(texts)) {
      const a = lastAmount();
      if (a) totalIn = a.minor;
      continue;
    }
    if (NOT_TRANSACTION_RE.test(line.text)) continue;

    const leading = leadingDate(texts);
    const middle = leading ? null : dateInColumn(line, layout);
    if (leading || middle) {
      const skip = new Set<number>();
      if (leading) for (let i = 0; i < leading.used; i++) skip.add(i);
      if (middle) skip.add(middle.index);

      const amounts: AmountCell[] = [];
      const description: string[] = [];
      line.cells.forEach((cell, i) => {
        if (skip.has(i)) return;
        const amount = parseAmount(cell.text);
        if (amount && layout) {
          const role = amountColumnFor(layout, cell);
          if (role) {
            amounts.push({ amount, role });
            return;
          }
        } else if (amount && !layout && (amounts.length > 0 || description.length > 0)) {
          amounts.push({ amount, role: null });
          return;
        }
        // Short codes in a money column (Absa's charge letters, "*") aren't description.
        if (layout && cell.text.length <= 3 && amountColumnFor(layout, cell)) return;
        if (amounts.length === 0 || layout) description.push(cell.text);
        // without a layout, text after the amounts (e.g. a fee code) is ignored
      });
      if (amounts.length === 0 || description.length === 0) continue;

      drafts.push({
        date: (leading ?? middle)!.date,
        rawDescription: description,
        amounts,
        continuationLines: 0,
        page: line.page,
      });
      continue;
    }

    // A wrapped description line belongs to the transaction above it.
    const last = drafts.at(-1);
    const looksLikeText = texts.every((t) => parseAmount(t) === null) && line.text.length <= 120;
    if (last && looksLikeText && last.page === line.page && last.continuationLines < 2 && !HEADER_RE.test(line.text)) {
      last.rawDescription.push(line.text);
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

  // ---- Newest-first statements: put rows in date order so the balance walk works ----
  let ascending = 0;
  let descending = 0;
  for (let i = 1; i < drafts.length; i++) {
    const a = dateKey(drafts[i - 1]!.date);
    const b = dateKey(drafts[i]!.date);
    if (b > a) ascending++;
    else if (b < a) descending++;
  }
  const newestFirst = descending > ascending * 2 && descending >= 2;
  if (newestFirst) drafts.reverse();

  // ---- Statement period and years ----
  let period = options.period ?? statementPeriod ?? null;
  let periodSource: ValidationSummary["period_source"] = options.period ? "user" : statementPeriod ? "statement" : "transactions";
  const fallbackYear = today.getUTCFullYear();
  if (drafts.some((d) => !d.date.year) && !period) {
    warnings.push("The statement dates have no year, so we assumed this year. Check the statement period.");
  }

  // ---- Sign convention for unmarked amounts ----
  let crMarkers = 0;
  let minusMarkers = 0;
  for (const draft of drafts) {
    for (const { amount, role } of draft.amounts) {
      if (role === "balance") continue;
      if (amount.marker === 1) crMarkers++;
      if (amount.marker === -1) minusMarkers++;
    }
  }
  let unmarked: { direction: Direction; confidence: number } | null = null;
  if (profile.signConvention === "cr_marks_credit") unmarked = { direction: "outflow", confidence: 0.8 };
  else if (profile.signConvention === "minus_marks_debit") unmarked = { direction: "inflow", confidence: 0.8 };
  else if (crMarkers > minusMarkers) unmarked = { direction: "outflow", confidence: 0.7 };
  else if (minusMarkers > 0) unmarked = { direction: "inflow", confidence: 0.7 };

  // ---- Pass 2: drafts → rows, checked against the running balance ----
  const rows: ParsedRow[] = [];
  let previous = opening;
  let mismatched = 0;
  let checked = 0;
  let skipped = 0;
  let feeRows = 0;

  const push = (row: Omit<ParsedRow, "rowIndex">) => rows.push({ ...row, rowIndex: rows.length });

  for (const draft of drafts) {
    const date = resolveDate(draft.date, period?.end ?? null, fallbackYear);
    if (!date) {
      skipped++;
      continue;
    }
    const rawDescription = draft.rawDescription.join(" ");

    // Sort the line's amounts into transaction amount, fee and balance.
    const byRole = (role: ColumnRole) => draft.amounts.filter((a) => a.role === role).map((a) => a.amount);
    let balanceAmount: ParsedAmount | null = null;
    let fee = 0;
    // Candidate transaction amounts with any direction their column implies.
    let candidates: { amount: ParsedAmount; column: Direction | null }[] = [];

    if (draft.amounts.some((a) => a.role !== null)) {
      balanceAmount = byRole("balance").at(-1) ?? null;
      fee = byRole("fee").reduce((sum, a) => sum + a.minor, 0);
      candidates = [
        ...byRole("debit").filter((a) => a.minor > 0).map((amount) => ({ amount, column: "outflow" as Direction })),
        ...byRole("credit").filter((a) => a.minor > 0).map((amount) => ({ amount, column: "inflow" as Direction })),
        ...byRole("amount").filter((a) => a.minor > 0).map((amount) => ({ amount, column: null })),
      ];
      // A line with only a fee (e.g. a monthly fee row in the Fee column) is itself the transaction.
      if (candidates.length === 0 && fee > 0) {
        candidates = [{ amount: { minor: fee, marker: -1 }, column: "outflow" }];
        fee = 0;
      }
    } else {
      // No layout: the last amount is the balance when there are two or more.
      const plain = draft.amounts.map((a) => a.amount);
      balanceAmount = plain.length >= 2 ? plain.at(-1)! : null;
      const rest = plain.length >= 2 ? plain.slice(0, -1) : plain;
      // Nearest-to-balance first: that's the usual amount column.
      candidates = [...rest].reverse().map((amount) => ({ amount, column: null }));
    }
    if (candidates.length === 0) {
      skipped++;
      continue;
    }

    const balance = balanceAmount ? signedBalance(balanceAmount) : null;
    let chosen = candidates[0]!;
    let direction: Direction | null = null;
    let check: BalanceCheck = "none";
    let feeApplied = false;
    let confidence = 0.5;

    if (previous !== null && balance !== null) {
      const delta = balance - previous;
      // Try every candidate amount, with and without the fee, against the balance.
      outer: for (const candidate of candidates) {
        const amount = candidate.amount.minor;
        const options: [number, Direction, boolean][] = [
          [amount, "inflow", false],
          [-amount, "outflow", false],
          ...(fee > 0 ? ([[-(amount + fee), "outflow", true], [amount - fee, "inflow", true]] as [number, Direction, boolean][]) : []),
        ];
        for (const [expected, dir, withFee] of options) {
          if (delta === expected) {
            chosen = candidate;
            direction = dir;
            feeApplied = withFee;
            check = "ok";
            confidence = 0.98;
            break outer;
          }
        }
      }
      if (check !== "ok") check = "mismatch";
    }

    if (!direction) {
      if (chosen.column) {
        direction = chosen.column;
        confidence = 0.9;
      } else if (chosen.amount.marker === 1) {
        direction = "inflow";
        confidence = 0.85;
      } else if (chosen.amount.marker === -1) {
        direction = "outflow";
        confidence = 0.85;
      } else if (unmarked) {
        direction = unmarked.direction;
        confidence = unmarked.confidence;
      } else {
        direction = "outflow";
        confidence = 0.5;
      }
      if (check === "mismatch") confidence = 0.4;
      // Without a balance, trust the bank's fee rule.
      if (check === "none" && fee > 0) feeApplied = profile.feeColumn !== "accrued_separately";
    }

    if (check !== "none") checked++;
    if (check === "mismatch") mismatched++;
    if (balance !== null) previous = balance;

    const flags: RowFlag[] = [];
    if (check === "mismatch") flags.push("balance_mismatch");
    if (check === "none" && confidence < 0.75) flags.push("direction_guessed");

    push({
      date,
      description: cleanDescription(rawDescription),
      amountMinor: chosen.amount.minor,
      direction,
      balanceMinor: balance,
      balanceCheck: check,
      extractionConfidence: confidence,
      channel: detectChannel(rawDescription, direction),
      flags,
    });

    if (feeApplied && fee > 0) {
      feeRows++;
      const verified = check === "ok" || profile.feeColumn === "deducted_on_line";
      push({
        date,
        description: cleanDescription(`Fee: ${rawDescription}`),
        amountMinor: fee,
        direction: "outflow",
        balanceMinor: null,
        balanceCheck: check === "ok" ? "ok" : "none",
        extractionConfidence: check === "ok" ? 0.98 : verified ? 0.8 : 0.5,
        channel: "bank_fee",
        flags: verified ? ["fee_split"] : ["fee_split", "fee_unverified"],
      });
    }
  }

  if (rows.length === 0) {
    throw new StatementParseError(
      "We found lines that look like transactions, but none had a valid date and amount. Choose your bank manually or enter the statement period.",
    );
  }
  if (skipped > 0) {
    warnings.push(`${skipped} line(s) looked like transactions but had an invalid date or amount, so they were left out. Compare the total with your statement.`);
  }

  if (!period) {
    const dates = rows.map((r) => r.date).sort();
    period = { start: dates[0]!, end: dates.at(-1)! };
    periodSource = "transactions";
  }

  // ---- Row-level checks ----
  const sortedAmounts = rows.map((r) => r.amountMinor).sort((a, b) => a - b);
  const median = sortedAmounts[Math.floor(sortedAmounts.length / 2)] ?? 0;
  const seen = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (row.date < period.start || row.date > period.end) row.flags.push("outside_period");
    if (row.date > todayIso) row.flags.push("future_date");
    if (row.amountMinor >= LARGE_MIN_MINOR && row.amountMinor >= median * LARGE_FACTOR) row.flags.push("large_amount");
    const key = `${row.date}|${row.amountMinor}|${row.direction}|${normaliseForMatch(row.description)}`;
    seen.set(key, [...(seen.get(key) ?? []), row]);
  }
  for (const group of seen.values()) {
    if (group.length > 1) for (const row of group) row.flags.push("repeat_in_statement");
  }

  const outside = rows.filter((r) => r.flags.includes("outside_period")).length;
  if (outside > 0) warnings.push(`${outside} transaction(s) fall outside the statement period.`);
  const future = rows.filter((r) => r.flags.includes("future_date")).length;
  if (future > 0) warnings.push(`${future} transaction(s) are dated in the future. Check the statement period and year.`);

  const balanceCheck: ValidationSummary["balance_check"] =
    checked === 0 ? "unavailable" : mismatched === 0 ? "passed" : "mismatch";
  if (balanceCheck === "mismatch") {
    warnings.push(`${mismatched} row(s) don't match the running balance. Check their amounts and whether they're money in or out.`);
    if (checked >= 5 && mismatched / checked > 0.5) {
      warnings.push("Most rows don't match the running balance, so this layout may not have been read correctly. Try choosing your bank manually.");
    }
  }
  if (balanceCheck === "unavailable") {
    warnings.push("This statement has no running balance we could read, so money in/out could not be double-checked.");
  }

  const net = rows.reduce((sum, r) => sum + (r.direction === "inflow" ? r.amountMinor : -r.amountMinor), 0);
  let totalsCheck: ValidationSummary["totals_check"] = "unavailable";
  if (opening !== null && closing !== null) {
    totalsCheck = opening + net === closing ? "passed" : "failed";
    if (totalsCheck === "failed") {
      warnings.push("Opening balance plus transactions doesn't equal the closing balance. Some rows may be missing.");
    }
  }

  let columnTotals: ValidationSummary["column_totals_check"] = "unavailable";
  if (totalOut !== null || totalIn !== null) {
    const sumOut = rows.filter((r) => r.direction === "outflow").reduce((s, r) => s + r.amountMinor, 0);
    const sumIn = rows.filter((r) => r.direction === "inflow").reduce((s, r) => s + r.amountMinor, 0);
    const okOut = totalOut === null || totalOut === sumOut;
    const okIn = totalIn === null || totalIn === sumIn;
    columnTotals = okOut && okIn ? "passed" : "failed";
    if (columnTotals === "failed") {
      warnings.push("The statement's own money-in/money-out totals don't match the rows we read. Some rows may be missing or misread.");
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
      parser: "column-v2",
      has_warnings: warnings.length > 0,
      detected_bank: detectedBank,
      row_count: rows.length,
      rows_skipped: skipped,
      layout_detected: layoutSeen,
      newest_first: newestFirst,
      balance_check: balanceCheck,
      mismatched_rows: mismatched,
      totals_check: totalsCheck,
      column_totals_check: columnTotals,
      opening_balance_minor: opening,
      closing_balance_minor: closing,
      period_source: periodSource,
      rows_outside_period: outside,
      fee_rows: feeRows,
      warnings,
    },
  };
}
