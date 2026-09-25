/**
 * ISBN handling. Spec §6: the EAN-13 digits on a book's barcode ARE its
 * ISBN-13, no conversion. What's added here: telling a book barcode apart
 * from any other EAN-13, and accepting a typed ISBN-10 from older books.
 *
 * Pure functions, no I/O — shared by the Scan screen and the server.
 */

/** EAN-13 / ISBN-13 check digit for the first 12 digits. */
function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/**
 * A valid ISBN-13: 13 digits, the Bookland prefix 978 or 979, and a correct
 * check digit. Other EAN-13 barcodes — groceries, store price labels — fail
 * the prefix test, which is how a stray scan of the wrong barcode is caught.
 */
export function isIsbn13(value: string): boolean {
  return (
    /^97[89]\d{10}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12])
  );
}

function isIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = value[i] === "X" ? 10 : Number(value[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/** ISBN-10 → ISBN-13: prefix 978, drop the old check digit, compute a new one. */
export function isbn10to13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return first12 + ean13CheckDigit(first12);
}

export type IsbnParse =
  | { ok: true; isbn13: string; convertedFrom10: boolean }
  | { ok: false; reason: string };

/**
 * Turns whatever was typed or scanned into an ISBN-13. Spaces and hyphens are
 * ignored; a lowercase x is accepted as the ISBN-10 check digit.
 */
export function parseIsbn(raw: string): IsbnParse {
  const value = raw.replace(/[\s-]/g, "").toUpperCase();
  if (value.length === 0) return { ok: false, reason: "Enter an ISBN." };

  if (value.length === 13) {
    if (!/^\d{13}$/.test(value)) return { ok: false, reason: "An ISBN has only digits." };
    if (!/^97[89]/.test(value)) {
      return { ok: false, reason: "That's not a book barcode — book ISBNs start with 978 or 979." };
    }
    if (!isIsbn13(value)) return { ok: false, reason: "That ISBN's last digit doesn't check out — a digit may be wrong." };
    return { ok: true, isbn13: value, convertedFrom10: false };
  }

  if (value.length === 10) {
    if (!/^\d{9}[\dX]$/.test(value)) {
      return { ok: false, reason: "A 10-digit ISBN has only digits, except an X at the end." };
    }
    if (!isIsbn10(value)) return { ok: false, reason: "That ISBN's last digit doesn't check out — a digit may be wrong." };
    return { ok: true, isbn13: isbn10to13(value), convertedFrom10: true };
  }

  return { ok: false, reason: `An ISBN has 10 or 13 digits — this has ${value.length}.` };
}

/**
 * Groups an ISBN-13 for reading aloud or comparing by eye: prefix, body,
 * check digit. (Proper ISBN hyphenation depends on registration-group tables
 * and isn't needed here.)
 */
export function formatIsbn(isbn13: string): string {
  return `${isbn13.slice(0, 3)}-${isbn13.slice(3, 12)}-${isbn13.slice(12)}`;
}
