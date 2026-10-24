/**
 * Bank statement formats. All use the same generic parser for now and are
 * marked "beta": the README requires each format to be tested against real
 * (anonymised) statements before it is advertised as supported.
 */
export type BankFormat = { key: string; name: string; match?: RegExp; status: "beta" };

export const BANK_FORMATS: BankFormat[] = [
  { key: "fnb", name: "FNB", match: /first national bank|fnb\.co\.za|\bfnb\b/i, status: "beta" },
  { key: "capitec", name: "Capitec", match: /capitec/i, status: "beta" },
  {
    key: "standard_bank",
    name: "Standard Bank",
    match: /standard\s*bank|standardbank\.co\.za|1962\/000738\/06/i,
    status: "beta",
  },
  { key: "absa", name: "Absa", match: /\babsa\b|absa\.co\.za/i, status: "beta" },
  { key: "nedbank", name: "Nedbank", match: /nedbank/i, status: "beta" },
  { key: "tymebank", name: "TymeBank", match: /tyme\s?bank/i, status: "beta" },
  { key: "discovery", name: "Discovery Bank", match: /discovery bank/i, status: "beta" },
  { key: "african_bank", name: "African Bank", match: /african bank/i, status: "beta" },
  { key: "investec", name: "Investec", match: /investec/i, status: "beta" },
  { key: "generic", name: "Other bank", status: "beta" },
];

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
