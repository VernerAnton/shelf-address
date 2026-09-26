import { getDb } from "@/lib/cloudflare";
import { isIsbn13 } from "@/lib/isbn";

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
  isbn13: string;
  locationId: string;
  condition: string | null;
  addedAt: string;
  title: string | null;
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
  isbn13: unknown;
  locationId: unknown;
  condition?: unknown;
  scannedAt?: unknown;
};

/** Logs one physical copy. Returns created: false if this id was already stored. */
export async function createCopy(input: NewCopy): Promise<{ created: boolean }> {
  const db = await getDb();
  const id = checkId(input.id);
  if (typeof input.isbn13 !== "string" || !isIsbn13(input.isbn13)) {
    throw new CopyError("That isn't a valid book ISBN.", 400);
  }
  const isbn13 = input.isbn13;
  const condition = checkCondition(input.condition);
  const addedAt = checkScannedAt(input.scannedAt);

  const existing = await db.prepare("SELECT 1 AS found FROM copies WHERE id = ?").bind(id).first();
  if (existing) return { created: false };

  const locationId = await checkPlace(db, input.locationId);

  // A placeholder edition so the copy has something to point at. Phase 4's
  // lookup fills in title, author and cover where fetched_at is still NULL.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO editions (isbn13) VALUES (?)").bind(isbn13),
    db
      .prepare(
        `INSERT INTO copies (id, isbn13, location_id, condition, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, isbn13, locationId, condition, addedAt),
  ]);
  return { created: true };
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

export async function getCopy(id: string): Promise<Copy | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT c.id, c.isbn13, c.location_id, c.condition, c.added_at, e.title
       FROM copies c LEFT JOIN editions e ON e.isbn13 = c.isbn13
       WHERE c.id = ?`,
    )
    .bind(id)
    .first<CopyRow>();
  return row ? toCopy(row) : null;
}

/** Copies logged at exactly this place (not in places inside it), newest first. */
export async function listCopiesAt(locationId: string): Promise<Copy[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT c.id, c.isbn13, c.location_id, c.condition, c.added_at, e.title
       FROM copies c LEFT JOIN editions e ON e.isbn13 = c.isbn13
       WHERE c.location_id = ?
       ORDER BY c.added_at DESC, c.id`,
    )
    .bind(locationId)
    .all<CopyRow>();
  return results.map(toCopy);
}

type CopyRow = {
  id: string;
  isbn13: string;
  location_id: string;
  condition: string | null;
  added_at: string;
  title: string | null;
};

function toCopy(row: CopyRow): Copy {
  return {
    id: row.id,
    isbn13: row.isbn13,
    locationId: row.location_id,
    condition: row.condition,
    addedAt: row.added_at,
    title: row.title,
  };
}
