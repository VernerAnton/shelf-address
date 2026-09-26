import { formatIsbn, isIsbn13 } from "@/lib/isbn";

/**
 * An edition's key (editions.isbn13, copies.isbn13): the ISBN-13 for a book
 * with a barcode, `finna:<record id>` for one picked from a Finna search, or
 * `manual:<uuid>` for one typed in by hand. docs/spec-corrections.md §12.
 */
export type EditionKind = "isbn" | "finna" | "manual";

const FINNA = /^finna:[\w.:-]{1,200}$/;
const MANUAL = /^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function editionKind(key: string): EditionKind | null {
  if (isIsbn13(key)) return "isbn";
  if (FINNA.test(key)) return "finna";
  if (MANUAL.test(key)) return "manual";
  return null;
}

/** How to show the key: the grouped ISBN, or "No ISBN". */
export function keyLabel(key: string): string {
  return editionKind(key) === "isbn" ? formatIsbn(key) : "No ISBN";
}
