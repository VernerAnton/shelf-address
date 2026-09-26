import { cleanTitle, parseYear } from "./names";

/**
 * Open Library — last in the chain. The edition record lists authors only by
 * reference, so their names take one more request each (at most three).
 * Its old /api/books endpoint no longer answers; /isbn/{isbn}.json does.
 */
export function openLibraryIsbnUrl(base: string, isbn13: string): string {
  return `${base}/isbn/${isbn13}.json`;
}

export function openLibraryAuthorUrl(base: string, key: string): string {
  return `${base}${key.startsWith("/") ? "" : "/"}${key}.json`;
}

/** Fallback cover by ISBN; `default=false` makes a missing cover a 404, not a blank image. */
export function openLibraryIsbnCoverUrl(coversBase: string, isbn13: string): string {
  return `${coversBase}/b/isbn/${isbn13}-L.jpg?default=false`;
}

export type OpenLibraryEdition = {
  title: string;
  publisher: string | null;
  year: number | null;
  language: string | null;
  authorKeys: string[];
  coverId: number | null;
};

export function parseOpenLibraryEdition(json: unknown): OpenLibraryEdition | null {
  const e = json as {
    title?: string;
    publishers?: string[];
    publish_date?: string;
    languages?: { key?: string }[];
    authors?: { key?: string }[];
    covers?: number[];
  };
  if (!e?.title) return null;
  return {
    title: cleanTitle(e.title),
    publisher: e.publishers?.[0] ?? null,
    year: parseYear(e.publish_date),
    language: e.languages?.[0]?.key?.split("/").pop() ?? null,
    authorKeys: (e.authors ?? []).map((a) => a.key).filter((k): k is string => Boolean(k)).slice(0, 3),
    coverId: e.covers?.find((c) => c > 0) ?? null,
  };
}

export function parseOpenLibraryAuthor(json: unknown): string | null {
  const name = (json as { name?: string; personal_name?: string })?.name;
  return name?.trim() || null;
}

export function openLibraryCoverUrl(coversBase: string, coverId: number): string {
  return `${coversBase}/b/id/${coverId}-L.jpg?default=false`;
}
