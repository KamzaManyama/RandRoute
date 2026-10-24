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
