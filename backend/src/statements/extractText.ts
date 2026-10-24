/**
 * Reads the text of a PDF in memory and groups it into lines and columns.
 * Nothing is written to disk and the raw text is never stored or logged.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Load pdf.js's worker code directly so it runs in this process. Without this,
// pdf.js loads it later by file name, and serverless bundlers (Vercel) leave
// that file out — every upload then fails as "couldn't be read as a PDF".
// @ts-expect-error — the worker module ships without type declarations
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= pdfjsWorker;

export type Cell = { text: string; x: number; right: number };
export type Line = { page: number; y: number; cells: Cell[]; text: string };

export class PdfReadError extends Error {
  constructor(
    public readonly code: "encrypted" | "unreadable" | "no_text" | "too_many_pages",
    message: string,
  ) {
    super(message);
    this.name = "PdfReadError";
  }
}

type RawItem = { text: string; x: number; y: number; right: number; size: number };

export async function extractLines(data: Uint8Array, { maxPages = 60 } = {}): Promise<Line[]> {
  const task = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = (error as { name?: string })?.name;

    if (name === "PasswordException") {
      throw new PdfReadError("encrypted", "This PDF is password-protected. Save an unlocked copy and try again.");
    }
    throw new PdfReadError("unreadable", "This file couldn't be read as a PDF. Check it opens on your device.");
  }

  try {
    if (pdf.numPages > maxPages) {
      throw new PdfReadError("too_many_pages", `This PDF has more than ${maxPages} pages. Upload one statement at a time.`);
    }

    const lines: Line[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [a, b, c, d, x, y] = item.transform as number[];
        const size = Math.hypot(c ?? 0, d ?? 0) || Math.hypot(a ?? 0, b ?? 0) || 10;
        items.push({ text: item.str, x: x ?? 0, y: y ?? 0, right: (x ?? 0) + (item.width ?? 0), size });
      }
      lines.push(...groupIntoLines(items, pageNumber));
      page.cleanup();
    }

    if (!lines.some((line) => /\d/.test(line.text))) {
      throw new PdfReadError(
        "no_text",
        "We couldn't find any text in this PDF. It may be a scanned image — download the statement from your banking app instead.",
      );
    }
    return lines;
  } finally {
    await task.destroy();
  }
}

/** Groups positioned text into lines (same y) and cells (text close together on x). */
export function groupIntoLines(items: RawItem[], page: number): Line[] {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows: RawItem[][] = [];
  for (const item of sorted) {
    const current = rows.at(-1);
    const tolerance = Math.max(2, item.size * 0.4);
    if (current && Math.abs(current[0]!.y - item.y) <= tolerance) current.push(item);
    else rows.push([item]);
  }

  return rows.map((row) => {
    row.sort((p, q) => p.x - q.x);
    const cells: Cell[] = [];
    for (const item of row) {
      const prev = cells.at(-1);
      const gap = prev ? item.x - prev.right : Infinity;
      if (prev && gap <= item.size * 0.6) {
        const needsSpace = gap > item.size * 0.12 && !prev.text.endsWith(" ") && !item.text.startsWith(" ");
        prev.text += (needsSpace ? " " : "") + item.text;
        prev.right = Math.max(prev.right, item.right);
      } else {
        cells.push({ text: item.text, x: item.x, right: item.right });
      }
    }
    for (const cell of cells) cell.text = cell.text.replace(/\s+/g, " ").trim();
    const cleanCells = cells.filter((cell) => cell.text);
    return { page, y: row[0]!.y, cells: cleanCells, text: cleanCells.map((c) => c.text).join("  ") };
  });
}
