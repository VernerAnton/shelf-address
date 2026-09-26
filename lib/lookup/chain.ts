import { finnaIsbnUrl, finnaRecordUrl, parseFinnaIsbnSearch, parseFinnaRecord } from "./finna";
import { googleIsbnUrl, parseGoogleBooks } from "./google";
import { joinNames } from "./names";
import {
  openLibraryAuthorUrl,
  openLibraryCoverUrl,
  openLibraryIsbnCoverUrl,
  openLibraryIsbnUrl,
  parseOpenLibraryAuthor,
  parseOpenLibraryEdition,
} from "./openlibrary";
import type { EditionData } from "./types";

/**
 * The lookup chain, spec §2.2: Finna → Google Books → Open Library.
 *
 * Details come from the first source that knows the book. A cover comes from
 * the first source that has one — Finna rarely does for older Finnish titles,
 * so the later sources are still asked for a cover even after Finna answered,
 * and Open Library's covers-by-ISBN is the last resort.
 *
 * No I/O of its own: `get` is passed in, which keeps this testable with
 * recorded responses.
 */

export type LookupConfig = {
  finnaBase: string;
  finnaCoverBase: string;
  googleBase: string;
  googleApiKey?: string;
  openLibraryBase: string;
  openLibraryCoversBase: string;
};

export const DEFAULT_CONFIG: LookupConfig = {
  finnaBase: "https://api.finna.fi",
  finnaCoverBase: "https://api.finna.fi",
  googleBase: "https://www.googleapis.com",
  openLibraryBase: "https://openlibrary.org",
  openLibraryCoversBase: "https://covers.openlibrary.org",
};

/** Resolves to status + parsed JSON; throws on a network failure. */
export type GetJson = (url: string) => Promise<{ status: number; json: unknown }>;

export type LookupResult =
  /** Found: store it. */
  | { outcome: "found"; data: EditionData }
  /** Every source answered and none knew the book. */
  | { outcome: "not_found" }
  /** At least one source couldn't be reached and none found it: try later. */
  | { outcome: "retry" };

type Step = { data: EditionData | null; unreachable: boolean };

async function ask(get: GetJson, url: string): Promise<{ json: unknown; unreachable: boolean } | null> {
  try {
    const { status, json } = await get(url);
    if (status === 200) return { json, unreachable: false };
    // Rate limits and server errors are temporary; anything else means "no".
    return status === 429 || status >= 500 ? { json: null, unreachable: true } : null;
  } catch {
    return { json: null, unreachable: true };
  }
}

async function fromFinna(get: GetJson, c: LookupConfig, isbn13: string): Promise<Step> {
  const res = await ask(get, finnaIsbnUrl(c.finnaBase, isbn13));
  return { data: res?.json ? parseFinnaIsbnSearch(res.json, isbn13, c.finnaCoverBase) : null, unreachable: Boolean(res?.unreachable) };
}

async function fromGoogle(get: GetJson, c: LookupConfig, isbn13: string): Promise<Step> {
  const res = await ask(get, googleIsbnUrl(c.googleBase, isbn13, c.googleApiKey));
  return { data: res?.json ? parseGoogleBooks(res.json, isbn13) : null, unreachable: Boolean(res?.unreachable) };
}

async function fromOpenLibrary(get: GetJson, c: LookupConfig, isbn13: string): Promise<Step> {
  const res = await ask(get, openLibraryIsbnUrl(c.openLibraryBase, isbn13));
  const edition = res?.json ? parseOpenLibraryEdition(res.json) : null;
  if (!edition) return { data: null, unreachable: Boolean(res?.unreachable) };
  const names: (string | null)[] = [];
  for (const key of edition.authorKeys) {
    const author = await ask(get, openLibraryAuthorUrl(c.openLibraryBase, key));
    names.push(author?.json ? parseOpenLibraryAuthor(author.json) : null);
  }
  return {
    data: {
      title: edition.title,
      author: joinNames(names),
      publisher: edition.publisher,
      year: edition.year,
      edition: null,
      language: edition.language,
      coverUrl: edition.coverId ? openLibraryCoverUrl(c.openLibraryCoversBase, edition.coverId) : null,
      source: "open_library",
    },
    unreachable: false,
  };
}

export async function lookupIsbn(isbn13: string, get: GetJson, config: LookupConfig = DEFAULT_CONFIG): Promise<LookupResult> {
  let found: EditionData | null = null;
  let unreachable = false;

  for (const source of [fromFinna, fromGoogle, fromOpenLibrary]) {
    if (found?.coverUrl) break; // have details and a cover: done
    const step = await source(get, config, isbn13);
    unreachable ||= step.unreachable;
    if (!step.data) continue;
    if (!found) found = step.data;
    else found.coverUrl ??= step.data.coverUrl;
  }

  if (found) {
    found.coverUrl ??= openLibraryIsbnCoverUrl(config.openLibraryCoversBase, isbn13);
    return { outcome: "found", data: found };
  }
  return unreachable ? { outcome: "retry" } : { outcome: "not_found" };
}

/** A barcode-less book picked from a Finna search: look up its own record. */
export async function lookupFinnaRecord(id: string, get: GetJson, config: LookupConfig = DEFAULT_CONFIG): Promise<LookupResult> {
  const res = await ask(get, finnaRecordUrl(config.finnaBase, id));
  if (res?.unreachable) return { outcome: "retry" };
  const data = res?.json ? parseFinnaRecord(res.json, config.finnaCoverBase) : null;
  return data ? { outcome: "found", data } : { outcome: "not_found" };
}
