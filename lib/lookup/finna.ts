import { isbn10to13, isIsbn13 } from "@/lib/isbn";
import { cleanTitle, joinNames, parseYear } from "./names";
import type { EditionChoice, EditionData } from "./types";

/**
 * Finna (api.finna.fi) — Finnish libraries, archives and museums, including
 * Fennica, the national bibliography. First in the lookup chain (spec §2.2)
 * because it covers the Finnish stock the others miss.
 *
 * Its ISBN search is fuzzy: it also returns other books, and individual
 * library records are sometimes miscatalogued. So records are kept only if
 * their own ISBN list contains ours, and the title is decided by a vote among
 * those — one library's error can't rename the book.
 */

const FIELDS = [
  "id",
  "title",
  "nonPresenterAuthors",
  "primaryAuthors",
  "publishers",
  "year",
  "languages",
  "images",
  "isbns",
  "edition",
  "formats",
];

function fieldParams(): string {
  return FIELDS.map((f) => `field[]=${encodeURIComponent(f)}`).join("&");
}

export function finnaIsbnUrl(base: string, isbn13: string): string {
  return `${base}/v1/search?lookfor=${isbn13}&type=ISN&limit=20&${fieldParams()}`;
}

export function finnaRecordUrl(base: string, id: string): string {
  return `${base}/v1/record?id[]=${encodeURIComponent(id)}&${fieldParams()}`;
}

/** Printed books only — Finna also holds audiobooks, e-books and recordings. */
export function finnaTitleSearchUrl(base: string, title: string, author: string): string {
  const params = new URLSearchParams();
  if (title) {
    params.append("lookfor0[]", title);
    params.append("type0[]", "Title");
  }
  if (author) {
    params.append("lookfor0[]", author);
    params.append("type0[]", "Author");
  }
  params.append("join", "AND");
  params.append("filter[]", 'format:"1/Book/Book/"');
  params.append("limit", "50");
  return `${base}/v1/search?${params}&${fieldParams()}`;
}

type FinnaAuthor = { name?: string; type?: string; role?: string };
type FinnaRecord = {
  id?: string;
  title?: string;
  nonPresenterAuthors?: FinnaAuthor[];
  primaryAuthors?: string[];
  publishers?: string[];
  year?: string;
  languages?: string[];
  images?: string[];
  isbns?: string[];
  edition?: string;
};

function records(json: unknown): FinnaRecord[] {
  const list = (json as { records?: unknown })?.records;
  return Array.isArray(list) ? (list as FinnaRecord[]) : [];
}

/** "951-0-23076-6 pehmeäkantinen" → "9789510230763". */
export function recordIsbns(record: FinnaRecord): string[] {
  const out: string[] = [];
  for (const entry of record.isbns ?? []) {
    const token = entry.trim().split(/\s+/)[0].replace(/[^0-9Xx]/g, "").toUpperCase();
    if (token.length === 13 && isIsbn13(token)) out.push(token);
    else if (token.length === 10) out.push(isbn10to13(token));
  }
  return out;
}

const AUTHOR_ROLES = /kirjoittaja|tekijä|author|författare|säveltäjä/i;

/**
 * The book's author(s). Records also list translators, illustrators and
 * readers. Where roles are given, the writers are picked out by role. Where
 * they aren't — common in older records — only the first person is used:
 * catalogues list the main author first, and "Paulo Coelho, Margaret Jull
 * Costa" would present a translator as a co-author.
 */
function authorsOf(record: FinnaRecord): string | null {
  const people = (record.nonPresenterAuthors ?? []).filter((a) => a.name && a.type === "Personal Name");
  const writers = people.filter((a) => a.role && AUTHOR_ROLES.test(a.role));
  if (writers.length) return joinNames(writers.map((a) => a.name));
  if (people.length) return joinNames([people[0].name]);
  return joinNames(record.primaryAuthors?.slice(0, 1) ?? []);
}

function coverOf(record: FinnaRecord, coverBase: string): string | null {
  const path = record.images?.[0];
  return path ? `${coverBase}${path.startsWith("/") ? "" : "/"}${path}` : null;
}

function toEdition(record: FinnaRecord, coverBase: string): EditionData {
  return {
    title: cleanTitle(record.title ?? ""),
    author: authorsOf(record),
    publisher: record.publishers?.[0] ? cleanTitle(record.publishers[0]) : null,
    year: parseYear(record.year),
    edition: record.edition ? cleanTitle(record.edition) : null,
    language: record.languages?.[0] ?? null,
    coverUrl: coverOf(record, coverBase),
    source: "finna",
  };
}

const titleKey = (title: string) =>
  cleanTitle(title).toLocaleLowerCase("fi-FI").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** How much a record fills in — the best-populated one of the winners is used. */
function richness(r: FinnaRecord): number {
  return (r.publishers?.length ? 1 : 0) + (r.year ? 1 : 0) + (r.images?.length ? 2 : 0) + (authorsOf(r) ? 1 : 0);
}

export function parseFinnaIsbnSearch(json: unknown, isbn13: string, coverBase: string): EditionData | null {
  const matching = records(json).filter((r) => r.title && recordIsbns(r).includes(isbn13));
  if (matching.length === 0) return null;

  const votes = new Map<string, number>();
  for (const r of matching) votes.set(titleKey(r.title!), (votes.get(titleKey(r.title!)) ?? 0) + 1);
  const best = Math.max(...votes.values());
  const winner = matching.find((r) => votes.get(titleKey(r.title!)) === best)!;
  const agreeing = matching.filter((r) => titleKey(r.title!) === titleKey(winner.title!));
  const richest = agreeing.reduce((a, b) => (richness(b) > richness(a) ? b : a));

  const data = toEdition(richest, coverBase);
  // A cover from any agreeing record is better than none.
  data.coverUrl ??= agreeing.map((r) => coverOf(r, coverBase)).find(Boolean) ?? null;
  return data;
}

export function parseFinnaRecord(json: unknown, coverBase: string): EditionData | null {
  const record = records(json)[0];
  return record?.title ? toEdition(record, coverBase) : null;
}

/**
 * Editions matching a title/author search, one entry per distinct edition:
 * Finna holds a record per library, so the same printing appears many times.
 */
export function parseFinnaEditionSearch(json: unknown, coverBase: string, limit = 12): EditionChoice[] {
  const seen = new Map<string, EditionChoice>();
  for (const r of records(json)) {
    if (!r.id || !r.title) continue;
    const data = toEdition(r, coverBase);
    const isbn13 = recordIsbns(r)[0] ?? null;
    const key = isbn13 ?? `${titleKey(r.title)}|${data.year ?? ""}|${(data.publisher ?? "").toLowerCase()}`;
    const existing = seen.get(key);
    if (existing) {
      existing.coverUrl ??= data.coverUrl;
      continue;
    }
    seen.set(key, {
      finnaId: r.id,
      title: data.title,
      author: data.author,
      publisher: data.publisher,
      year: data.year,
      isbn13,
      coverUrl: data.coverUrl,
    });
    if (seen.size === limit) break;
  }
  return [...seen.values()];
}
