import { getDb } from "@/lib/cloudflare";
import { checkId, checkPlace, CopyError, createCopy, listCopiesAt } from "@/lib/copies";
import { editionKind } from "@/lib/edition-key";
import { kickLookups } from "@/lib/editions";
import { listAllLocations, placeName } from "@/lib/locations";
import type { ExpectedCopy, MissingCopy, OtherPlace, ReviewPayload } from "@/lib/review";

/**
 * Review mode on the server (docs/spec-corrections.md §16). The phone takes a
 * snapshot when a review starts — so the review itself works offline — and
 * sends the whole result in one request when it's saved. The rules for what
 * each scan means live in lib/review.ts.
 */

export type ReviewSnapshot = {
  locationId: string;
  placeName: string;
  expected: ExpectedCopy[];
  missingElsewhere: MissingCopy[];
  otherPlaces: Record<string, OtherPlace[]>;
};

/** Copies marked missing anywhere (except at `exceptAt`), with where they were. */
export async function listMissing(exceptAt?: string): Promise<MissingCopy[]> {
  const db = await getDb();
  const [locations, { results }] = await Promise.all([
    listAllLocations(),
    db
      .prepare(
        `SELECT id, isbn13, location_id, missing_since FROM copies
         WHERE missing_since IS NOT NULL AND location_id <> ?
         ORDER BY missing_since, id`,
      )
      .bind(exceptAt ?? "")
      .all<{ id: string; isbn13: string; location_id: string; missing_since: string }>(),
  ]);
  return results.map((r) => ({
    copyId: r.id,
    key: r.isbn13,
    placeId: r.location_id,
    placeName: placeName(locations, r.location_id) ?? "another place",
    missingSince: r.missing_since,
  }));
}

export async function reviewSnapshot(locationId: string): Promise<ReviewSnapshot> {
  const db = await getDb();
  const locations = await listAllLocations();
  const place = locations.find((l) => l.id === locationId);
  if (!place) throw new CopyError("This place no longer exists.", 404);
  if (place.kind === "site") throw new CopyError("Books aren't logged directly at a site, so there's nothing to review here.");

  const copies = await listCopiesAt(locationId);
  const expected: ExpectedCopy[] = copies.map((c) => ({
    copyId: c.id,
    key: c.isbn13,
    title: c.edition.title,
    author: c.edition.author,
    coverUrl: c.edition.coverUrl,
    scannable: editionKind(c.isbn13) === "isbn",
    missingSince: c.missingSince,
  }));

  // Where else each of these books is: information for the "not found" list.
  const keys = [...new Set(expected.map((c) => c.key))];
  const otherPlaces: Record<string, OtherPlace[]> = {};
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT isbn13, location_id, COUNT(*) AS n, SUM(missing_since IS NOT NULL) AS m FROM copies
         WHERE isbn13 IN (${chunk.map(() => "?").join(",")}) AND location_id <> ?
         GROUP BY isbn13, location_id`,
      )
      .bind(...chunk, locationId)
      .all<{ isbn13: string; location_id: string; n: number; m: number }>();
    for (const r of results) {
      (otherPlaces[r.isbn13] ??= []).push({
        placeName: placeName(locations, r.location_id) ?? "another place",
        count: r.n,
        missing: r.m,
      });
    }
  }

  return {
    locationId,
    placeName: placeName(locations, locationId) ?? place.label,
    expected,
    missingElsewhere: await listMissing(locationId),
    otherPlaces,
  };
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(checkId);
}

/** Runs `sql` with `?list` expanded, in chunks D1's parameter limit allows. */
async function inChunks(db: D1Database, list: string[], sql: (marks: string) => string, extra: unknown[]) {
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    await db
      .prepare(sql(chunk.map(() => "?").join(",")))
      .bind(...extra, ...chunk)
      .run();
  }
}

/**
 * Saves a finished review. Every step is safe to repeat, so a retried upload
 * (a dropped response, an offline queue replaying) changes nothing twice.
 * Only copies still at this place are marked or removed: one moved away since
 * the review started is left alone.
 */
export async function applyReview(body: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  const input = body as Partial<Record<keyof ReviewPayload, unknown>>;
  const locationId = await checkPlace(db, input.locationId);
  const finishedAt = typeof input.finishedAt === "string" && !Number.isNaN(Date.parse(input.finishedAt))
    ? new Date(Math.min(Date.parse(input.finishedAt), Date.now())).toISOString().replace(/\.\d{3}Z$/, "Z")
    : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const add = Array.isArray(input.add) ? input.add : [];
  const keys: string[] = [];
  for (const item of add as Record<string, unknown>[]) {
    const { editionKey } = await createCopy({ id: item.copyId, editionKey: item.key, locationId, scannedAt: item.scannedAt });
    keys.push(editionKey);
  }

  await inChunks(db, ids(input.relocate), (m) => `UPDATE copies SET location_id = ?, missing_since = NULL WHERE id IN (${m})`, [locationId]);
  await inChunks(db, ids(input.found), (m) => `UPDATE copies SET missing_since = NULL WHERE location_id = ? AND id IN (${m})`, [locationId]);
  await inChunks(db, ids(input.remove), (m) => `DELETE FROM copies WHERE location_id = ? AND id IN (${m})`, [locationId]);
  await inChunks(
    db,
    ids(input.pending),
    (m) => `UPDATE copies SET missing_since = COALESCE(missing_since, ?) WHERE location_id = ? AND id IN (${m})`,
    [finishedAt, locationId],
  );
  await db.prepare("UPDATE locations SET reviewed_at = ? WHERE id = ?").bind(finishedAt, locationId).run();
  if (keys.length > 0) await kickLookups(keys[0]);
}
