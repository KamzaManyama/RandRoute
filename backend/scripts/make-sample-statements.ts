// Writes synthetic sample statements to backend/fixtures/ for manual testing.
// Run: npm run fixtures   (the PDFs are git-ignored)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStatementPdf, capitecStyle, fnbStyle } from "../src/statements/fixtures.js";

const outDir = resolve(import.meta.dirname, "../fixtures");
mkdirSync(outDir, { recursive: true });
const files: [string, Uint8Array][] = [
  ["sample-fnb-sep-2026.pdf", await buildStatementPdf(fnbStyle)],
  ["sample-capitec-oct-2026.pdf", await buildStatementPdf(capitecStyle)],
];
for (const [name, bytes] of files) {
  writeFileSync(resolve(outDir, name), bytes);
  console.log(`wrote fixtures/${name}`);
}
