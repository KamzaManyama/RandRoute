/**
 * Finds a statement's table header ("Date | Description | Debit | Credit |
 * Balance") and remembers where each column sits on the page, so amounts can
 * be read by column instead of guessed from their order on the line.
 *
 * This is what lets one parser read the different SA layouts:
 *   FNB           Date · Description · Amount · Balance · Accrued Bank Charges
 *   Capitec       Date · Description · Money In · Money Out · Fee · Balance
 *   Absa          Date · Transaction Description · Charge · Debit Amount · Credit Amount · Balance
 *   Standard Bank Details · Service Fee · Debits · Credits · Date · Balance
 *   Nedbank       Date · Description · Fees · Debits · Credits · Balance
 *   TymeBank      Date · Description · Fees · Money Out · Money In · Balance
 */
import type { Cell, Line } from "./extractText.js";

export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "fee" | "balance" | "other";
export const AMOUNT_ROLES: ReadonlySet<ColumnRole> = new Set(["amount", "debit", "credit", "fee", "balance"]);

export type Column = { role: ColumnRole; left: number; right: number };
export type Layout = { columns: Column[] };

const LABELS: [ColumnRole, RegExp][] = [
  ["date", /^(date|tran(s|saction)?\.? ?date|posting date|post date|value date|process(ing)? date)$/i],
  ["description", /^(description|details|transaction( description| details)?|narrative|particulars|reference|beneficiary)$/i],
  ["debit", /^(debits?|debit amount|money out|withdrawals?|paid out|payments?|debit \(r\))$/i],
  ["credit", /^(credits?|credit amount|money in|deposits?|paid in|receipts?|credit \(r\))$/i],
  ["fee", /^(fees?|charges?|service fees?|bank charges|accrued (bank )?charges|fee \(r\))$/i],
  ["balance", /^(balance|running balance|balance \(r\))$/i],
  ["amount", /^(amount|transaction amount|amount \(r\))$/i],
  ["other", /^(category|cheque number|ref(erence)? no\.?)$/i],
];

function roleOf(text: string): ColumnRole | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/[:*]$/, "");
  for (const [role, re] of LABELS) if (re.test(t)) return role;
  return null;
}

/** Header cells are sometimes merged ("Date Description"); split them back on known labels. */
function splitMerged(cell: Cell): { role: ColumnRole; cell: Cell }[] | null {
  const direct = roleOf(cell.text);
  if (direct) return [{ role: direct, cell }];
  const words = cell.text.split(/\s+/);
  if (words.length < 2 || words.length > 6) return null;
  // Greedy left-to-right: longest label first.
  const out: { role: ColumnRole; cell: Cell }[] = [];
  const width = (cell.right - cell.x) / Math.max(1, cell.text.length);
  let i = 0;
  let offset = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const role = roleOf(phrase);
      if (role) {
        const x = cell.x + offset * width;
        out.push({ role, cell: { text: phrase, x, right: x + phrase.length * width } });
        offset += phrase.length + 1;
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return out;
}

/** Returns a layout if this line looks like a transaction table header. */
export function detectHeader(line: Line): Layout | null {
  const found: { role: ColumnRole; cell: Cell }[] = [];
  for (const cell of line.cells) {
    const parts = splitMerged(cell);
    if (!parts) continue;
    found.push(...parts);
  }
  const roles = new Set(found.map((f) => f.role));
  const hasMoney = roles.has("balance") || roles.has("amount") || (roles.has("debit") && roles.has("credit"));
  const hasText = roles.has("date") || roles.has("description");
  // At least three recognised headings, including money columns and a date/description.
  if (found.length < 3 || !hasMoney || !hasText) return null;
  // A header line is mostly labels; reject lines with lots of other text.
  if (found.length < line.cells.length * 0.6) return null;

  const columns = found
    .map(({ role, cell }) => ({ role, left: cell.x, right: cell.right }))
    .sort((a, b) => a.left - b.left);
  return { columns };
}

/**
 * Which amount column does a cell belong to? Amounts are usually
 * right-aligned under their heading, headings may be centred; we compare the
 * cell to each money column's right edge and centre and take the closest.
 */
export function amountColumnFor(layout: Layout, cell: Cell): ColumnRole | null {
  const money = layout.columns.filter((c) => AMOUNT_ROLES.has(c.role));
  if (money.length === 0) return null;
  const centre = (cell.x + cell.right) / 2;
  let best: { role: ColumnRole; distance: number } | null = null;
  for (const column of money) {
    const colCentre = (column.left + column.right) / 2;
    const distance = Math.min(
      Math.abs(cell.right - column.right),
      Math.abs(centre - colCentre),
      // a long amount under a short heading: the heading sits inside the cell
      cell.x <= column.left && cell.right >= column.right ? 0 : Infinity,
    );
    if (!best || distance < best.distance) best = { role: column.role, distance };
  }
  // Too far from every money column: not a column amount (e.g. a number inside a description).
  const typicalGap = 60;
  return best && best.distance <= typicalGap ? best.role : null;
}

/** Is this cell in the date column (for layouts where the date isn't first)? */
export function isInColumn(layout: Layout, cell: Cell, role: ColumnRole): boolean {
  const column = layout.columns.find((c) => c.role === role);
  if (!column) return false;
  const centre = (cell.x + cell.right) / 2;
  return centre >= column.left - 25 && centre <= column.right + 25;
}
