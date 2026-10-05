import { parseIsbn } from "@/lib/isbn";

/**
 * Finding ISBNs in text read from a photo of a book's copyright page
 * (docs/spec-corrections.md §19) — for books whose barcode is covered.
 *
 * Text recognition makes mistakes, so every candidate must pass the ISBN
 * check digit; a misread number is dropped rather than giving the wrong book.
 * Common look-alikes (O for 0, l or I for 1…) are corrected inside number
 * runs only. A page often lists several ISBNs (hardback, paperback, e-book):
 * each comes with the rest of its line ("(sid.)", "PDF") so the person can
 * pick the one for the book in hand.
 */

export type FoundIsbn = { isbn13: string; label: string };

const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", Z: "2", S: "5", B: "8" };

/** A run that could be an ISBN: digits, separators and look-alikes, ending in a digit or X. */
const RUN = /[0-9OoDQIl|ZSB][0-9OoDQIl|ZSB\s\-–.]{8,24}[0-9Xx]/g;

export function findIsbns(text: string): FoundIsbn[] {
  const found = new Map<string, FoundIsbn>();
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(RUN)) {
      const digits = match[0]
        .split("")
        .map((c) => LOOKALIKE[c] ?? c)
        .join("")
        .replace(/[^0-9Xx]/g, "")
        .toUpperCase();
      // Every 13-character window (a run can carry extra digits); 10-character
      // windows only if there's no 13 — inside an ISBN-13, a 10-digit stretch
      // can pass the older check digit by chance.
      const rest = line
        .slice(match.index + match[0].length)
        .replace(/^[\s:;,.]+/, "")
        .trim();
      for (const size of [13, 10]) {
        let any = false;
        for (let i = 0; i + size <= digits.length; i++) {
          const parsed = parseIsbn(digits.slice(i, i + size));
          if (!parsed.ok) continue;
          any = true;
          if (!found.has(parsed.isbn13)) found.set(parsed.isbn13, { isbn13: parsed.isbn13, label: rest.slice(0, 40) });
        }
        if (any) break;
      }
    }
  }
  return [...found.values()];
}
