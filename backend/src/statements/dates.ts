/** Date parsing for South African statements. Outputs ISO "YYYY-MM-DD" strings. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export type PartialDate = { day: number; month: number; year: number | null };

const textMonth = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?(?:[\s\-/.]+(\d{2}|\d{4}))?$/;
const isoLike = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
const dmShort = /^(\d{1,2})[/](\d{1,2})$/;

function fullYear(y: string | undefined): number | null {
  if (!y) return null;
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function valid(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Parses one date token. Day-first for numeric dates (SA convention). */
export function parseDateToken(text: string): PartialDate | null {
  const t = text.trim();
  let m = textMonth.exec(t);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith("sept") ? 4 : 3)];
    const day = Number(m[1]);
    if (month && valid(day, month)) return { day, month, year: fullYear(m[3]) };
    return null;
  }
  m = isoLike.exec(t);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(day, month) ? { day, month, year } : null;
  }
  m = dmy.exec(t);
  if (m) {
    const [day, month] = [Number(m[1]), Number(m[2])];
    return valid(day, month) ? { day, month, year: fullYear(m[3]) } : null;
  }
  m = dmShort.exec(t);
  if (m) {
    const [day, month] = [Number(m[1]), Number(m[2])];
    return valid(day, month) ? { day, month, year: null } : null;
  }
  return null;
}

export function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // e.g. 31 Feb
  return date.toISOString().slice(0, 10);
}

/**
 * Fills in a missing year using the statement period. A December row on a
 * statement ending in January belongs to the previous year.
 */
export function resolveDate(date: PartialDate, periodEndIso: string | null, fallbackYear: number): string | null {
  if (date.year) return toIso(date.year, date.month, date.day);
  if (!periodEndIso) return toIso(fallbackYear, date.month, date.day);
  const endYear = Number(periodEndIso.slice(0, 4));
  const candidate = toIso(endYear, date.month, date.day);
  if (candidate && candidate > periodEndIso) return toIso(endYear - 1, date.month, date.day);
  return candidate;
}

/** Finds "01 Sep 2026 to 30 Sep 2026" style statement periods in free text. */
export function findPeriod(text: string): { start: string; end: string } | null {
  const token = String.raw`(\d{1,2}[\s\-/.]+[A-Za-z]{3,9}\.?[\s\-/.]+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})`;
  // "01 Sep 2026 to 30 Sep 2026", "01/10/2026 - 31/10/2026", "From Date: 28/04/2026 To Date: 23/10/2026"
  const re = new RegExp(`${token}\\s*(?:to|till|until|-|–|—)(?:\\s+date)?\\s*:?\\s*${token}`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const a = parseDateToken(m[1]!);
  const b = parseDateToken(m[2]!);
  if (!a?.year || !b?.year) return null;
  const start = toIso(a.year, a.month, a.day);
  const end = toIso(b.year, b.month, b.day);
  if (!start || !end || end < start) return null;
  return { start, end };
}
