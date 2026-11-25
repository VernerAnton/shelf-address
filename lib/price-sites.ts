import { antikvaariSearchUrl } from "@/lib/antikvaari";

/**
 * BookOps' price check (docs/spec-corrections.md §30): one button per site,
 * each opening that site's own search with the book already filled in — the
 * ISBN, or the title and author for a book without one. Only plain links:
 * nothing is fetched or shown inside the app, and no price is suggested. The
 * person looks and decides.
 */
export type PriceSite = {
  id: "antikvaari" | "adlibris" | "suomalainen" | "akateeminen";
  name: string;
  /** What he's looking for there. */
  about: string;
  url: (query: string) => string;
};

const q = (query: string) => encodeURIComponent(query.trim());

export const PRICE_SITES: PriceSite[] = [
  { id: "antikvaari", name: "Antikvaari.fi", about: "Used · other shops' prices", url: antikvaariSearchUrl },
  { id: "adlibris", name: "Adlibris", about: "New · price and stock", url: (s) => `https://www.adlibris.com/fi/haku?q=${q(s)}` },
  { id: "suomalainen", name: "Suomalainen", about: "New · price and stock", url: (s) => `https://www.suomalainen.com/search?q=${q(s)}` },
  { id: "akateeminen", name: "Akateeminen", about: "New · price and stock", url: (s) => `https://www.akateeminen.com/search?q=${q(s)}` },
];

/** What to search the sites for: the ISBN if there is one, else title and author; null if neither is known yet. */
export function priceQuery(book: { isbn13: string | null; title: string | null; author: string | null }): string | null {
  if (book.isbn13) return book.isbn13;
  const words = [book.title, book.author].map((s) => s?.trim()).filter(Boolean).join(" ");
  return words || null;
}
