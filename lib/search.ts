/**
 * Catalog search text. SQLite's LIKE only folds A–Z, so "Ä" wouldn't match
 * "ä"; instead each edition stores a pre-folded `search_text` and queries are
 * folded the same way here. Punctuation becomes spaces, so "Mr. Fox" and
 * "mr fox" match, and LIKE wildcards can never come through from input.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("fi-FI")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function editionSearchText(e: {
  key: string;
  title: string | null;
  author: string | null;
  publisher?: string | null;
}): string {
  const isbn = /^\d{13}$/.test(e.key) ? e.key : "";
  return foldForSearch([e.title, e.author, e.publisher, isbn].filter(Boolean).join(" "));
}

/** The words of a query, each matched anywhere in search_text (all must match). */
export function searchWords(query: string): string[] {
  return [...new Set(foldForSearch(query).split(" ").filter(Boolean))].slice(0, 6);
}
