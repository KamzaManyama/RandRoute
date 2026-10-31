/**
 * Bank statement profiles.
 *
 * Parsing is column-aware and generic (see layout.ts and parser.ts). A profile
 * adds what is specific to one bank:
 *   - how to recognise its statements
 *   - how it marks money in/out when there is no running balance to check
 *   - whether its "fees" column is already deducted on the same line
 *     (Capitec) or only accrued and charged later as its own line (FNB)
 *
 * `support` is shown to users so we never over-promise:
 *   - "layout_rules": bank-specific rules + automated tests against synthetic
 *     statements built to that bank's published column layout
 *   - "generic": read with the generic rules only
 * Every format is still "beta" until it has been checked against real,
 * anonymised statements (see README → Statement formats).
 */
export type SignConvention =
  /** Credits carry "Cr"; unmarked amounts are money out (FNB). */
  | "cr_marks_credit"
  /** Debits carry "-"; unmarked amounts are money in (Capitec, TymeBank, Standard Bank digital). */
  | "minus_marks_debit"
  /** Work it out from the statement itself. */
  | "infer";

export type FeeColumn = "deducted_on_line" | "accrued_separately" | "unknown";

export type BankFormat = {
  key: string;
  name: string;
  match?: RegExp;
  status: "beta";
  support: "layout_rules" | "generic";
  signConvention: SignConvention;
  feeColumn: FeeColumn;
  /** Short note shown on the upload screen. */
  notes?: string;
};

export const BANK_FORMATS: BankFormat[] = [
  {
    key: "fnb",
    name: "FNB",
    match: /first national bank|fnb\.co\.za|\bfnb\b/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "cr_marks_credit",
    feeColumn: "accrued_separately",
    notes: "Cheque, savings and credit card statements with a running balance.",
  },
  {
    key: "capitec",
    name: "Capitec",
    match: /capitec/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "minus_marks_debit",
    feeColumn: "deducted_on_line",
    notes: "Money in / Money out / Fee / Balance layout.",
  },
  {
    key: "absa",
    name: "Absa",
    match: /\babsa\b|absa\.co\.za/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "infer",
    feeColumn: "unknown",
    notes: "Debit amount / Credit amount / Balance layout.",
  },
  {
    key: "standard_bank",
    name: "Standard Bank",
    match: /standard\s*bank|standardbank\.co\.za|1962\/000738\/06/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "minus_marks_debit",
    feeColumn: "unknown",
    notes: "Details / Debits / Credits / Date / Balance layout, including the date-in-the-middle style.",
  },
  {
    key: "nedbank",
    name: "Nedbank",
    match: /nedbank/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "infer",
    feeColumn: "unknown",
    notes: "Fees / Debits / Credits / Balance layout.",
  },
  {
    key: "tymebank",
    name: "TymeBank",
    match: /tyme\s?bank/i,
    status: "beta",
    support: "layout_rules",
    signConvention: "minus_marks_debit",
    feeColumn: "deducted_on_line",
    notes: "Money out / Money in / Fees / Balance layout.",
  },
  { key: "discovery", name: "Discovery Bank", match: /discovery bank/i, status: "beta", support: "generic", signConvention: "infer", feeColumn: "unknown" },
  { key: "african_bank", name: "African Bank", match: /african bank/i, status: "beta", support: "generic", signConvention: "infer", feeColumn: "unknown" },
  { key: "investec", name: "Investec", match: /investec/i, status: "beta", support: "generic", signConvention: "infer", feeColumn: "unknown" },
  { key: "generic", name: "Other bank", status: "beta", support: "generic", signConvention: "infer", feeColumn: "unknown" },
];

export function getFormat(key: string): BankFormat {
  return BANK_FORMATS.find((f) => f.key === key) ?? BANK_FORMATS.at(-1)!;
}

export function formatName(key: string): string {
  return BANK_FORMATS.find((f) => f.key === key)?.name ?? "Other bank";
}

export function isKnownFormat(key: string): boolean {
  return BANK_FORMATS.some((f) => f.key === key);
}

/**
 * Works out which bank issued a statement.
 *
 * Statements mention other banks all the time ("Payment to Capitec",
 * "Absa ATM"), so a name anywhere isn't enough. Each bank is scored by WHERE
 * its name appears:
 *   - header (top of page 1, before the first transaction): 10 points each
 *   - other non-transaction lines (footers, legal text, page headers): 3 points
 *   - inside transaction lines: ignored
 * The highest score wins.
 */
export function detectBank(lines: { text: string; isHeader: boolean; isTransaction: boolean }[]): string | null {
  let best: { key: string; score: number } | null = null;
  for (const format of BANK_FORMATS) {
    if (!format.match) continue;
    const re = new RegExp(format.match.source, "gi");
    let score = 0;
    for (const line of lines) {
      if (line.isTransaction) continue;
      const hits = line.text.match(re)?.length ?? 0;
      score += hits * (line.isHeader ? 10 : 3);
    }
    if (score > 0 && (!best || score > best.score)) best = { key: format.key, score };
  }
  return best?.key ?? null;
}
