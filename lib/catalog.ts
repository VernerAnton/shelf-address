import { displayAddress } from "@/lib/address";
import { getDb } from "@/lib/cloudflare";
import { listCopiesOf, type Copy } from "@/lib/copies";
import { EDITION_COLUMNS, toEdition, type Edition } from "@/lib/editions";
import { parseIsbn } from "@/lib/isbn";
import { collator, nearestAddressed, pathIn } from "@/lib/location-model";
import { listAllLocations } from "@/lib/locations";
import { searchWords } from "@/lib/search";

/**
 * The Catalog tab: "where is this book?" (spec §1 item 4, §4). Each result is
 * an edition with every copy of it and where each one is.
 */

export type WhereCopy = {
  id: string;
  condition: string | null;
  addedAt: string;
  /** The answer: "Warehouse A — Bulevard 1" — the nearest address above the copy. */
  address: string | null;
  /** The exact place, when it's more specific than the address (e.g. "Row 2"). */
  place: string;
  /** Root-to-place trail, for places with no address anywhere above them. */
  trail: string;
};

export type CatalogHit = { edition: Edition; copies: WhereCopy[] };

const LIMIT = 40;

async function where(copies: Copy[]): Promise<Map<string, WhereCopy[]>> {
  const locations = await listAllLocations();
  const byEdition = new Map<string, WhereCopy[]>();
  for (const copy of copies) {
    const path = pathIn(locations, copy.locationId);
    const place = path.at(-1);
    const site = path[0]?.kind === "site" ? path[0].label : null;
    const addressed = nearestAddressed(path);
    const entry: WhereCopy = {
      id: copy.id,
      condition: copy.condition,
      addedAt: copy.addedAt,
      address: addressed?.address ? displayAddress(addressed.address, site) : null,
      place: place && place.id !== addressed?.id ? place.label : "",
      trail: path.map((l) => l.label).join(" › "),
    };
    byEdition.set(copy.isbn13, [...(byEdition.get(copy.isbn13) ?? []), entry]);
  }
  return byEdition;
}

async function withCopies(editions: Edition[]): Promise<CatalogHit[]> {
  const copies = await listCopiesOf(editions.map((e) => e.key));
  const places = await where(copies);
  return editions.map((edition) => ({ edition, copies: places.get(edition.key) ?? [] }));
}

const byTitle = (a: Edition, b: Edition) => collator.compare(a.title ?? "￿", b.title ?? "￿");

/** Title, author or ISBN (any format). Only editions with a copy logged. */
export async function searchCatalog(query: string): Promise<CatalogHit[]> {
  const db = await getDb();
  const isbn = parseIsbn(query);
  let sql: string;
  let args: string[];
  if (isbn.ok) {
    sql = "e.isbn13 = ?";
    args = [isbn.isbn13];
  } else {
    const words = searchWords(query);
    if (words.length === 0) return [];
    sql = words.map(() => "e.search_text LIKE ?").join(" AND ");
    args = words.map((w) => `%${w}%`);
  }
  const { results } = await db
    .prepare(
      `SELECT ${EDITION_COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")} FROM editions e
       WHERE ${sql} AND EXISTS (SELECT 1 FROM copies c WHERE c.isbn13 = e.isbn13)
       LIMIT ${LIMIT}`,
    )
    .bind(...args)
    .all<Parameters<typeof toEdition>[0]>();
  return withCopies(results.map(toEdition).sort(byTitle));
}

export async function needsReview(): Promise<CatalogHit[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT ${EDITION_COLUMNS} FROM editions e
       WHERE needs_review = 1 AND EXISTS (SELECT 1 FROM copies c WHERE c.isbn13 = e.isbn13)
       LIMIT 200`,
    )
    .all<Parameters<typeof toEdition>[0]>();
  return withCopies(results.map(toEdition).sort(byTitle));
}

/** The most recently logged editions, newest first. */
export async function recentlyLogged(limit = 10): Promise<CatalogHit[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT ${EDITION_COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")} FROM editions e
       JOIN (SELECT isbn13, MAX(added_at) AS last FROM copies GROUP BY isbn13) c ON c.isbn13 = e.isbn13
       ORDER BY c.last DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Parameters<typeof toEdition>[0]>();
  return withCopies(results.map(toEdition));
}

export async function catalogCounts() {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM copies) AS copies,
              (SELECT COUNT(DISTINCT isbn13) FROM copies) AS editions,
              (SELECT COUNT(*) FROM editions e WHERE needs_review = 1
                 AND EXISTS (SELECT 1 FROM copies c WHERE c.isbn13 = e.isbn13)) AS review`,
    )
    .first<{ copies: number; editions: number; review: number }>();
  return row ?? { copies: 0, editions: 0, review: 0 };
}
