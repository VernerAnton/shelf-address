/** What a lookup source knows about one edition, normalised across sources. */
export type EditionData = {
  title: string;
  /** Display form, "Mika Waltari, Jukka Parkkinen". */
  author: string | null;
  publisher: string | null;
  year: number | null;
  edition: string | null;
  /** ISO 639 code as the source gives it ("fin", "fi", "eng"). */
  language: string | null;
  /** Where the cover can be downloaded — fetched once into R2, never hotlinked (§2.2). */
  coverUrl: string | null;
  source: "finna" | "google_books" | "open_library";
};

/** An edition offered when logging a book without a barcode. */
export type EditionChoice = {
  finnaId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  /** Set when Finna knows one; the book is then logged under its ISBN. */
  isbn13: string | null;
  coverUrl: string | null;
};
