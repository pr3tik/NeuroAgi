// deckExport.ts — pure helpers for getting a flashcard deck *out* of the app.
//
// Students already keep decks in Quizlet/Anki/Google Sheets, so a deck that can't
// leave is a deck they won't build. Everything here is a pure string transform
// (unit-tested in test/deckExport.test.ts) except downloadText(), which is the one
// browser-touching function and no-ops outside a DOM.

export type DeckCard = { q: string; a: string };

/** RFC 4180 says records are separated by CRLF. Excel/Sheets both want it. */
const CRLF = "\r\n";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/**
 * Escape one CSV field per RFC 4180: fields containing a quote, comma, CR or LF
 * are wrapped in double quotes, and inner quotes are doubled.
 */
function csvField(value: unknown): string {
  const s = str(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Deck → CSV with a `Term,Definition` header (the column names Quizlet and most
 * spreadsheets expect). When `title` is given it is emitted as a single escaped
 * field on the first line so the file is self-describing; omit the title for a
 * strictly import-ready file. Always ends with a trailing CRLF.
 */
export function toCSV(cards: DeckCard[] | null | undefined, title?: string): string {
  const rows: string[] = [];
  const t = str(title).trim();
  if (t) rows.push(csvField(t));
  rows.push("Term,Definition");
  for (const card of cards ?? []) {
    rows.push(`${csvField(card?.q)},${csvField(card?.a)}`);
  }
  return rows.join(CRLF) + CRLF;
}

/** Collapse anything that would break a TSV record (tabs / newlines) into spaces. */
function tsvField(value: unknown): string {
  return str(value).replace(/[\t\r\n\v\f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Deck → tab-separated lines, one card per line: the lingua franca of flashcard
 * imports. Anki's "Import file" and Quizlet's "Import from Word, Excel, Google Docs"
 * both read this directly (tab between term/definition, newline between cards).
 */
export function toAnkiTSV(cards: DeckCard[] | null | undefined): string {
  return (cards ?? []).map((card) => `${tsvField(card?.q)}\t${tsvField(card?.a)}`).join("\n");
}

/**
 * Slugify a deck title into a safe download filename.
 * `"Media & Society — Day 5"` → `"media-society-day-5.csv"`.
 */
export function deckFilename(title?: string, ext: string = "csv"): string {
  const slug = str(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics left behind by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")        // everything else becomes a separator
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/, "");
  const clean = str(ext).replace(/^\.+/, "").toLowerCase() || "csv";
  return `${slug || "flashcards"}.${clean}`;
}

/**
 * Trigger a file download from a string. Returns false (and does nothing) outside a
 * browser so callers can be rendered/tested under node or SSR.
 */
export function downloadText(filename: string, mime: string, text: string): boolean {
  if (typeof document === "undefined" || typeof Blob === "undefined") return false;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;

  const url = URL.createObjectURL(new Blob([str(text)], { type: mime || "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "flashcards.txt";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — Safari/Firefox need the URL alive until the click settles.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } }, 0);
  return true;
}
