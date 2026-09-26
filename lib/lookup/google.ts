import { isbn10to13 } from "@/lib/isbn";
import { cleanTitle, joinNames, parseYear } from "./names";
import type { EditionData } from "./types";

/**
 * Google Books — second in the chain. Without an API key it shares a global
 * anonymous quota that is often exhausted (it was when this was written), so
 * GOOGLE_BOOKS_API_KEY is supported and recommended; without one, a refusal
 * just passes the lookup on to Open Library.
 */
export function googleIsbnUrl(base: string, isbn13: string, apiKey: string | undefined): string {
  return `${base}/books/v1/volumes?q=isbn:${isbn13}${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}`;
}

type Volume = {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    language?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

function volumeIsbns(v: Volume): string[] {
  return (v.volumeInfo?.industryIdentifiers ?? []).flatMap((id) => {
    const value = (id.identifier ?? "").replace(/[^0-9X]/gi, "").toUpperCase();
    if (id.type === "ISBN_13" && value.length === 13) return [value];
    if (id.type === "ISBN_10" && value.length === 10) return [isbn10to13(value)];
    return [];
  });
}

export function parseGoogleBooks(json: unknown, isbn13: string): EditionData | null {
  const items = (json as { items?: Volume[] })?.items ?? [];
  // Google's isbn: search is fuzzy too; only trust a volume listing our ISBN.
  const volume = items.find((v) => volumeIsbns(v).includes(isbn13));
  const info = volume?.volumeInfo;
  if (!info?.title) return null;
  const image = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    title: cleanTitle(info.title),
    author: joinNames(info.authors ?? []),
    publisher: info.publisher ?? null,
    year: parseYear(info.publishedDate),
    edition: null,
    language: info.language ?? null,
    // Google hands out http:// image links; its image hosts serve https too.
    coverUrl: image
      ? image.replace(/^http:\/\/(books\.google\.|[\w.-]*googleusercontent\.)/, "https://$1").replace(/&edge=curl/, "")
      : null,
    source: "google_books",
  };
}
