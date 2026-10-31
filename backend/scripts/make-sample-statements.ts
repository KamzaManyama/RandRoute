// Writes synthetic sample statements to backend/fixtures/ for manual testing.
// Run: npm run fixtures   (the PDFs are git-ignored)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  absaColumns,
  buildStatementPdf,
  buildTablePdf,
  capitecColumns,
  capitecStyle,
  fnbStyle,
  nedbankColumns,
  standardBankColumns,
  tymeBankColumns,
} from "../src/statements/fixtures.js";

const outDir = resolve(import.meta.dirname, "../fixtures");
mkdirSync(outDir, { recursive: true });
const files: [string, Uint8Array][] = [
  ["sample-fnb-sep-2026.pdf", await buildStatementPdf(fnbStyle)],
  ["sample-capitec-oct-2026.pdf", await buildStatementPdf(capitecStyle)],
  ["sample-capitec-columns-oct-2026.pdf", await buildTablePdf(capitecColumns)],
  ["sample-absa-sep-2026.pdf", await buildTablePdf(absaColumns)],
  ["sample-standard-bank-aug-2026.pdf", await buildTablePdf(standardBankColumns)],
  ["sample-nedbank-jul-2026.pdf", await buildTablePdf(nedbankColumns)],
  ["sample-tymebank-jun-2026.pdf", await buildTablePdf(tymeBankColumns)],
];
for (const [name, bytes] of files) {
  writeFileSync(resolve(outDir, name), bytes);
  console.log(`wrote fixtures/${name}`);
}
