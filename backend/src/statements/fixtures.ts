/**
 * Builds synthetic bank-statement PDFs for tests and manual testing.
 * Every name, number and transaction here is made up — never use real statements.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

export type FixtureRow = { date: string; description: string[]; amount: string; balance?: string };

export type FixtureSpec = {
  bankLine: string;
  headerLines: string[];
  openingLine?: { label: string; amount: string };
  closingLine?: { label: string; amount: string };
  rows: FixtureRow[];
  rowsPerPage?: number;
};

export async function buildStatementPdf(spec: FixtureSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 9;
  const rightAlign = (text: string, right: number) => right - font.widthOfTextAtSize(text, size);

  const perPage = spec.rowsPerPage ?? 28;
  const pages = Math.max(1, Math.ceil(spec.rows.length / perPage));
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    page.drawText(spec.bankLine, { x: 40, y, size: 14, font: bold });
    y -= 22;
    for (const line of spec.headerLines) {
      page.drawText(line, { x: 40, y, size, font });
      y -= 14;
    }
    y -= 10;
    page.drawText("Date", { x: 40, y, size, font: bold });
    page.drawText("Description", { x: 110, y, size, font: bold });
    page.drawText("Amount", { x: rightAlign("Amount", 450), y, size, font: bold });
    page.drawText("Balance", { x: rightAlign("Balance", 550), y, size, font: bold });
    y -= 16;

    if (p === 0 && spec.openingLine) {
      page.drawText(spec.openingLine.label, { x: 110, y, size, font });
      page.drawText(spec.openingLine.amount, { x: rightAlign(spec.openingLine.amount, 550), y, size, font });
      y -= 14;
    }

    for (const row of spec.rows.slice(p * perPage, (p + 1) * perPage)) {
      page.drawText(row.date, { x: 40, y, size, font });
      page.drawText(row.description[0]!, { x: 110, y, size, font });
      page.drawText(row.amount, { x: rightAlign(row.amount, 450), y, size, font });
      if (row.balance) page.drawText(row.balance, { x: rightAlign(row.balance, 550), y, size, font });
      y -= 12;
      for (const extra of row.description.slice(1)) {
        page.drawText(extra, { x: 110, y, size, font });
        y -= 12;
      }
      y -= 2;
    }

    if (p === pages - 1 && spec.closingLine) {
      y -= 4;
      page.drawText(spec.closingLine.label, { x: 110, y, size, font });
      page.drawText(spec.closingLine.amount, { x: rightAlign(spec.closingLine.amount, 550), y, size, font });
    }
    page.drawText(`Page ${p + 1} of ${pages}`, { x: 40, y: 30, size: 8, font });
  }
  return doc.save();
}

/** FNB-style: credits marked "Cr", debits unmarked, running balance, wrapped descriptions. */
export const fnbStyle: FixtureSpec = {
  bankLine: "First National Bank",
  headerLines: [
    "Gold Cheque Account  62000000001",
    "Ms T Example, 1 Example Street, Johannesburg",
    "Statement Period : 01 September 2026 to 30 September 2026",
  ],
  openingLine: { label: "Opening Balance", amount: "5 000.00Cr" },
  rows: [
    { date: "01 Sep", description: ["POS Purchase Checkers Sandton", "4111********1234"], amount: "450.00", balance: "4 550.00Cr" },
    { date: "02 Sep", description: ["Uber Trip"], amount: "89.50", balance: "4 460.50Cr" },
    { date: "05 Sep", description: ["Vodacom Prepaid Airtime 0820000000"], amount: "29.00", balance: "4 431.50Cr" },
    { date: "10 Sep", description: ["Netflix.com Subscription"], amount: "199.00", balance: "4 232.50Cr" },
    { date: "15 Sep", description: ["Transfer From Savings Own Acc"], amount: "1 000.00Cr", balance: "5 232.50Cr" },
    { date: "20 Sep", description: ["Woolworths Refund"], amount: "120.00Cr", balance: "5 352.50Cr" },
    { date: "25 Sep", description: ["Salary ACME Holdings Ref 998877665"], amount: "25 000.00Cr", balance: "30 352.50Cr" },
    { date: "26 Sep", description: ["Rent Payment Example Properties"], amount: "8 500.00", balance: "21 852.50Cr" },
    { date: "28 Sep", description: ["Mystery Shop Pty Ltd"], amount: "300.00", balance: "21 552.50Cr" },
    { date: "30 Sep", description: ["#Monthly Account Fee"], amount: "69.00", balance: "21 483.50Cr" },
  ],
  closingLine: { label: "Closing Balance", amount: "21 483.50Cr" },
};

/** Capitec-style: full dates, debits negative, credits unmarked. */
export const capitecStyle: FixtureSpec = {
  bankLine: "Capitec Bank",
  headerLines: ["Main Account", "Statement period: 01/10/2026 - 31/10/2026"],
  openingLine: { label: "Opening Balance", amount: "1 200.00" },
  rows: [
    { date: "01/10/2026", description: ["Pick n Pay Rosebank"], amount: "-310.25", balance: "889.75" },
    { date: "03/10/2026", description: ["Engen Fuel"], amount: "-500.00", balance: "389.75" },
    { date: "05/10/2026", description: ["Payment Received J Example"], amount: "2 000.00", balance: "2 389.75" },
    { date: "07/10/2026", description: ["Eskom Prepaid Electricity"], amount: "-350.00", balance: "2 039.75" },
  ],
  closingLine: { label: "Closing Balance", amount: "2 039.75" },
};

// ---------------------------------------------------------------------------
// Monthly demo statements (FNB-style) with realistic, made-up spending.
// Running balances are calculated so every row passes the balance check.
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rand(minor: number): string {
  const [whole, cents] = (minor / 100).toFixed(2).split(".") as [string, string];
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${cents}`;
}

/** Deterministic wobble so each month differs a little. */
function wobble(seed: number, spread: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return Math.round((x - Math.floor(x) - 0.5) * 2 * spread);
}

type DemoTx = { day: number; description: string; minor: number; credit?: boolean };

function demoTransactions(m: number): DemoTx[] {
  return [
    { day: 1, description: "Debit Order Example Properties Rent", minor: 850000 },
    { day: 2, description: "POS Purchase Checkers Sandton", minor: 118000 + wobble(m, 15000) },
    { day: 3, description: "Uber Trip", minor: 9200 + wobble(m + 1, 3000) },
    { day: 5, description: "Vodacom Prepaid Airtime", minor: 29900 },
    { day: 6, description: "Eskom Prepaid Electricity", minor: 65000 + wobble(m + 2, 12000) },
    { day: 8, description: "Netflix.com Subscription", minor: 19900 },
    { day: 9, description: "Spotify Premium", minor: 7999 },
    { day: 10, description: "Engen Fuel Rosebank", minor: 85000 + wobble(m + 3, 20000) },
    { day: 12, description: "POS Purchase Woolworths Food", minor: 64000 + wobble(m + 4, 12000) },
    { day: 14, description: "Uber Eats Order", minor: 21000 + wobble(m + 5, 9000) },
    { day: 15, description: "Transfer To Savings Own Acc", minor: 200000 },
    { day: 16, description: "Discovery Life Insurance Debit Order", minor: 45000 },
    { day: 18, description: "Pick n Pay Rosebank", minor: 52000 + wobble(m + 6, 10000) },
    { day: 20, description: "Dis-Chem Pharmacy", minor: 18000 + wobble(m + 7, 8000) },
    { day: 22, description: "Takealot Online", minor: 35000 + wobble(m + 8, 25000) },
    { day: 25, description: "Salary ACME Holdings", minor: 2850000, credit: true },
    { day: 26, description: "Nandos Rosebank", minor: 32000 + wobble(m + 9, 9000) },
    { day: 27, description: "Virgin Active Gym Debit Order", minor: 59900 },
    { day: 28, description: "Payment Received From M Example", minor: 50000, credit: true },
    { day: 28, description: "#Monthly Account Fee", minor: 6900 },
  ];
}

/** A whole-month FNB-style statement for "YYYY-MM". */
export function demoMonthStatement(month: string, openingMinor: number): { spec: FixtureSpec; closingMinor: number } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  let balance = openingMinor;
  const rows: FixtureRow[] = demoTransactions(mon).map((t) => {
    balance += t.credit ? t.minor : -t.minor;
    return {
      date: `${String(t.day).padStart(2, "0")} ${SHORT[mon - 1]}`,
      description: [t.description],
      amount: `${rand(t.minor)}${t.credit ? "Cr" : ""}`,
      balance: `${rand(balance)}Cr`,
    };
  });
  return {
    closingMinor: balance,
    spec: {
      bankLine: "First National Bank",
      headerLines: [
        "Gold Cheque Account",
        `Statement Period : 01 ${MONTH_NAMES[mon - 1]} ${year} to ${lastDay} ${MONTH_NAMES[mon - 1]} ${year}`,
      ],
      openingLine: { label: "Opening Balance", amount: `${rand(openingMinor)}Cr` },
      rows,
      closingLine: { label: "Closing Balance", amount: `${rand(balance)}Cr` },
    },
  };
}
