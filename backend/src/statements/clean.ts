/**
 * Turns a raw statement description into something safe and readable to store.
 * Removes card numbers, account numbers, long references and email addresses —
 * we only keep what's needed to recognise the transaction.
 */
export function cleanDescription(raw: string): string {
  let text = raw
    .replace(/\s+/g, " ")
    // masked or full card numbers: 4111********1111, 4111 xxxx xxxx 1111, ****1111
    .replace(/\b\d{4}[\s*xX•.-]{4,}\d{0,4}\b/g, " ")
    .replace(/[*xX•]{4,}\d{2,4}\b/g, " ")
    // email addresses
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " ")
    // any run of 6+ digits (account numbers, references, phone numbers, ID numbers)
    .replace(/\d[\d\s-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? " " : m))
    // leftover "ref:", "acc no" labels with nothing after them
    .replace(/\b(ref(erence)?|acc(ount)?\s*(no|number)?|card\s*no)\b\s*[:#.]?\s*(?=$|\s{2,})/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Trim stray punctuation left behind
  text = text.replace(/^[\s:;,.#*-]+|[\s:;,#*-]+$/g, "").trim();
  if (!text) return "Transaction";
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** Lower-case, letters/digits only — used to compare descriptions for duplicates. */
export function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Share of words two descriptions have in common (0–1). */
export function descriptionSimilarity(a: string, b: string): number {
  const wa = new Set(normaliseForMatch(a).split(" ").filter((w) => w.length > 1));
  const wb = new Set(normaliseForMatch(b).split(" ").filter((w) => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}
