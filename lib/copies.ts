import { getDb } from "@/lib/cloudflare";
import { editionKind, type EditionKind } from "@/lib/edition-key";
import { EDITION_COLUMNS, toEdition, type Edition } from "@/lib/editions";
import { editionSearchText } from "@/lib/search";

/**
 * Copies: one row per physical book (spec §2.3, as amended in
 * docs/spec-corrections.md §4 — no price, no stock status).
 *
 * Writes are designed for an unreliable connection (spec-corrections §8):
 * the phone generates each copy's id, so uploading the same scan twice —
 * a retry after a dropped response — stores it once.
 */

import { CONDITIONS, isCondition } from "@/lib/copy-model";

export type Copy = {
  id: string;
  /** The edition key: an ISBN-13, or finna:/manual: for a book without one. */
  isbn13: string;
  locationId: string;
  condition: string | null;
  addedAt: string;
  edition: Edition;
};

/**
 * A request that will never succeed as sent — bad input, or a place that no
 * longer exists. The offline queue stops retrying these and shows the reason;
 * anything else is treated as temporary and retried.
 */
export class CopyError extends Error {
  constructor(
    message: string,
    readonly status: number = 422,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkId(id: unknown): string {
  if (typeof id !== "string" || !UUID.test(id)) throw new CopyError("Invalid copy id.", 400);
  return id.toLowerCase();
}

/** One of the store's grades K1–K5, or none. */
function checkCondition(condition: unknown): string | null {
  if (condition === null || condition === undefined || condition === "") return null;
  if (!isCondition(condition)) {
    throw new CopyError(`Condition must be one of ${CONDITIONS.join(", ")}.`, 400);
  }
  return condition;
}

/**
 * When the book was scanned, not when it reached the server — an offline scan
 * may upload hours later. Anything unparseable or in the future falls back to
 * now.
 */
function checkScannedAt(value: unknown): string {
  const now = Date.now();
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t) && t <= now + 60_000) return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A place a book can be logged at: it must exist and must not be a site (§2.3). */
async function checkPlace(db: D1Database, locationId: unknown): Promise<string> {
  if (typeof locationId !== "string" || !locationId) {
    throw new CopyError("Choose a place to log the book at.", 400);
  }
  const place = await db
    .prepare("SELECT kind FROM locations WHERE id = ?")
    .bind(locationId)
    .first<{ kind: string }>();
  if (!place) {
    throw new CopyError("That place no longer exists — it may have been deleted. Choose another.");
  }
  if (place.kind === "site") {
    throw new CopyError("Books can't be logged directly at a site. Choose a shelf or section.");
  }
  return locationId;
}

export type NewCopy = {
  id: unknown;
  /** Edition key. `isbn13` is the name older phones' queued scans use. */
  editionKey?: unknown;
  isbn13?: unknown;
  /** Details for a book without an ISBN (finna: or manual: key). */
  edition?: unknown;
  locationId: unknown;
  condition?: unknown;
  scannedAt?: unknown;
};

type Details = { title: string; author: string | null; publisher: string | null; year: number | null };

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.length > max) throw new CopyError(`Keep it under ${max} characters.`, 400);
  return cleaned || null;
}

/** Title/author/year sent with a barcode-less book. */
export function checkDetails(value: unknown, { requireTitle }: { requireTitle: boolean }): Details | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const title = text(v.title, 300);
  if (!title) {
    if (requireTitle) throw new CopyError("A book without an ISBN needs a title.", 400);
    return null;
  }
  const yearNumber = typeof v.year === "number" ? v.year : typeof v.year === "string" && v.year.trim() ? Number(v.year) : null;
  if (yearNumber !== null && (!Number.isInteger(yearNumber) || yearNumber < 1450 || yearNumber > new Date().getFullYear() + 1)) {
    throw new CopyError("That year doesn't look right.", 400);
  }
  return { title, author: text(v.author, 200), publisher: text(v.publisher, 200), year: yearNumber };
}

/**
 * The edition row a copy points at, created if new. For a scanned ISBN it's a
 * placeholder the lookup chain fills in (lib/editions.ts). A Finna pick
 * arrives with the details shown in the search, so it's findable at once; its
 * lookup then replaces them with Finna's own record. A typed-in book is kept
 * as typed and flagged for review. An edition that already exists is left
 * exactly as it is.
 */
function ensureEdition(db: D1Database, key: string, kind: EditionKind, details: Details | null) {
  if (kind === "isbn") {
    return db
      .prepare("INSERT OR IGNORE INTO editions (isbn13, search_text) VALUES (?, ?)")
      .bind(key, editionSearchText({ key, title: null, author: null }));
  }
  return db
    .prepare(
      `INSERT OR IGNORE INTO editions
         (isbn13, title, author, publisher, year, source, lookup_status, needs_review, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      details?.title ?? null,
      details?.author ?? null,
      details?.publisher ?? null,
      details?.year ?? null,
      kind === "manual" ? "manual" : "finna",
      kind === "manual" ? "skipped" : "pending",
      kind === "manual" ? 1 : 0,
      editionSearchText({ key, title: details?.title ?? null, author: details?.author ?? null, publisher: details?.publisher }),
    );
}

/** Logs one physical copy. Returns created: false if this id was already stored. */
export async function createCopy(input: NewCopy): Promise<{ created: boolean; editionKey: string }> {
  const db = await getDb();
  const id = checkId(input.id);
  const key = input.editionKey ?? input.isbn13;
  const kind = typeof key === "string" ? editionKind(key) : null;
  if (typeof key !== "string" || !kind) throw new CopyError("That isn't a valid book ISBN.", 400);
  const condition = checkCondition(input.condition);
  const addedAt = checkScannedAt(input.scannedAt);
  const details = kind === "isbn" ? null : checkDetails(input.edition, { requireTitle: kind === "manual" });

  const existing = await db.prepare("SELECT 1 AS found FROM copies WHERE id = ?").bind(id).first();
  if (existing) return { created: false, editionKey: key };

  const locationId = await checkPlace(db, input.locationId);

  const edition = ensureEdition(db, key, kind, details);

  await db.batch([
    edition,
    db
      .prepare(
        `INSERT INTO copies (id, isbn13, location_id, condition, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, key, locationId, condition, addedAt),
  ]);
  return { created: true, editionKey: key };
}

/** Removes a copy. Removing one that's already gone is not an error. */
export async function deleteCopy(id: unknown): Promise<void> {
  const db = await getDb();
  await db.prepare("DELETE FROM copies WHERE id = ?").bind(checkId(id)).run();
}

export async function setCondition(id: unknown, condition: unknown): Promise<void> {
  const db = await getDb();
  const result = await db
    .prepare("UPDATE copies SET condition = ? WHERE id = ?")
    .bind(checkCondition(condition), checkId(id))
    .run();
  if (result.meta.changes === 0) throw new CopyError("That book is no longer logged.", 404);
}

export async function moveCopy(id: unknown, locationId: unknown): Promise<void> {
  const db = await getDb();
  const target = await checkPlace(db, locationId);
  const result = await db
    .prepare("UPDATE copies SET location_id = ? WHERE id = ?")
    .bind(target, checkId(id))
    .run();
  if (result.meta.changes === 0) throw new CopyError("That book is no longer logged.", 404);
}

const COPY_SELECT = `SELECT c.id, c.location_id, c.condition, c.added_at,
  ${EDITION_COLUMNS.split(", ").map((col) => `e.${col}`).join(", ")}
  FROM copies c JOIN editions e ON e.isbn13 = c.isbn13`;

export async function getCopy(id: string): Promise<Copy | null> {
  const db = await getDb();
  const row = await db.prepare(`${COPY_SELECT} WHERE c.id = ?`).bind(id).first<CopyRow>();
  return row ? toCopy(row) : null;
}

/** Copies logged at exactly this place (not in places inside it), newest first. */
export async function listCopiesAt(locationId: string): Promise<Copy[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(`${COPY_SELECT} WHERE c.location_id = ? ORDER BY c.added_at DESC, c.id`)
    .bind(locationId)
    .all<CopyRow>();
  return results.map(toCopy);
}

/** Every copy of the given editions, for the Catalog. */
export async function listCopiesOf(keys: string[]): Promise<Copy[]> {
  if (keys.length === 0) return [];
  const db = await getDb();
  const { results } = await db
    .prepare(`${COPY_SELECT} WHERE c.isbn13 IN (${keys.map(() => "?").join(",")}) ORDER BY c.added_at DESC`)
    .bind(...keys)
    .all<CopyRow>();
  return results.map(toCopy);
}

type CopyRow = Parameters<typeof toEdition>[0] & {
  id: string;
  location_id: string;
  condition: string | null;
  added_at: string;
};

function toCopy(row: CopyRow): Copy {
  return {
    id: row.id,
    isbn13: row.isbn13,
    locationId: row.location_id,
    condition: row.condition,
    addedAt: row.added_at,
    edition: toEdition(row),
  };
}

/**
 * "Wrong book?": points a copy at a different edition — for a barcode that
 * belongs to another book (misprints happen). The copy moves; the edition it
 * came from is left untouched, since real copies of that ISBN may exist.
 * With `sameBarcode`, every other copy logged under the old key moves too.
 * Returns the new key and how many copies changed.
 */
export async function reassignCopy(
  copyId: unknown,
  input: { key: unknown; details?: unknown },
  { sameBarcode }: { sameBarcode: boolean },
): Promise<{ key: string; changed: number }> {
  const db = await getDb();
  const id = checkId(copyId);
  const copy = await db.prepare("SELECT isbn13 FROM copies WHERE id = ?").bind(id).first<{ isbn13: string }>();
  if (!copy) throw new CopyError("That book is no longer logged.", 404);

  const key = typeof input.key === "string" ? input.key : "";
  const kind = editionKind(key);
  if (!kind) throw new CopyError("That isn't a valid book ISBN.", 400);
  if (key === copy.isbn13) throw new CopyError("That's the book it's already logged as.", 400);
  const details = kind === "isbn" ? null : checkDetails(input.details, { requireTitle: kind === "manual" });

  const move = sameBarcode
    ? db.prepare("UPDATE copies SET isbn13 = ? WHERE isbn13 = ?").bind(key, copy.isbn13)
    : db.prepare("UPDATE copies SET isbn13 = ? WHERE id = ?").bind(key, id);
  const [, moved] = await db.batch([ensureEdition(db, key, kind, details), move]);
  return { key, changed: moved.meta.changes ?? 0 };
}

/** How many other copies share this copy's barcode (edition key). */
export async function countSameBarcode(copyId: string): Promise<number> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM copies
       WHERE isbn13 = (SELECT isbn13 FROM copies WHERE id = ?) AND id <> ?`,
    )
    .bind(copyId, copyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
