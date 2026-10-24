/**
 * Bank statement formats. All use the same generic parser for now and are
 * marked "beta": the README requires each format to be tested against real
 * (anonymised) statements before it is advertised as supported.
 */
export type BankFormat = { key: string; name: string; match?: RegExp; status: "beta" };

export const BANK_FORMATS: BankFormat[] = [
  { key: "fnb", name: "FNB", match: /first national bank|\bfnb\b/i, status: "beta" },
  { key: "capitec", name: "Capitec", match: /capitec/i, status: "beta" },
  { key: "standard_bank", name: "Standard Bank", match: /standard bank/i, status: "beta" },
  { key: "absa", name: "Absa", match: /\babsa\b/i, status: "beta" },
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

export function detectBank(text: string): string | null {
  return BANK_FORMATS.find((f) => f.match?.test(text))?.key ?? null;
}
