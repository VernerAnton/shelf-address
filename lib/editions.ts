import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getBucket, getDb, getEnv } from "@/lib/cloudflare";
import { editionKind } from "@/lib/edition-key";
import { DEFAULT_CONFIG, lookupFinnaRecord, lookupIsbn, type GetJson, type LookupConfig } from "@/lib/lookup/chain";
import type { EditionData } from "@/lib/lookup/types";
import { editionSearchText } from "@/lib/search";
import { IMAGE_TYPES, imageProblem } from "@/lib/images";

/**
 * Editions: the per-book metadata cache (spec §2.2) and the lookup runner
 * that fills it.
 *
 * Lookups happen on the server, after the scan has been saved — never in the
 * way of scanning, and never needing the phone to have signal. A failed
 * lookup is retried with a pause between tries; after MAX_ATTEMPTS it's
 * recorded as not found rather than retried forever.
 */

export type LookupStatus = "pending" | "found" | "not_found" | "skipped";

export type Edition = {
  key: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  year: number | null;
  source: string | null;
  coverUrl: string | null;
  /** The cover is a photo taken on the phone; lookups leave it alone. */
  coverByHand: boolean;
  lookupStatus: LookupStatus;
  needsReview: boolean;
};

type EditionRow = {
  isbn13: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  year: number | null;
  source: string | null;
  cover_url: string | null;
  cover_by_hand: number;
  lookup_status: LookupStatus;
  needs_review: number;
};

export const EDITION_COLUMNS =
  "isbn13, title, author, publisher, year, source, cover_url, cover_by_hand, lookup_status, needs_review";

export function toEdition(row: EditionRow): Edition {
  return {
    key: row.isbn13,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    year: row.year,
    source: row.source,
    coverUrl: row.cover_url ? `/${row.cover_url}` : null,
    coverByHand: row.cover_by_hand === 1,
    lookupStatus: row.lookup_status,
    needsReview: row.needs_review === 1,
  };
}

const MAX_ATTEMPTS = 6;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const COVER_MAX_BYTES = 3 * 1024 * 1024;
const USER_AGENT = "Shelf-Address/1 (personal bookshop shelf index)";

async function lookupConfig(): Promise<LookupConfig> {
  // Overridable so tests can point the chain at a local stand-in; production
  // uses the real services. GOOGLE_BOOKS_API_KEY is a Worker secret.
  const env = (await getEnv()) as unknown as Record<string, string | undefined>;
  return {
    finnaBase: env.FINNA_API_BASE ?? DEFAULT_CONFIG.finnaBase,
    finnaCoverBase: env.FINNA_COVER_BASE ?? env.FINNA_API_BASE ?? DEFAULT_CONFIG.finnaCoverBase,
    googleBase: env.GOOGLE_BOOKS_API_BASE ?? DEFAULT_CONFIG.googleBase,
    googleApiKey: env.GOOGLE_BOOKS_API_KEY || undefined,
    openLibraryBase: env.OPEN_LIBRARY_BASE ?? DEFAULT_CONFIG.openLibraryBase,
    openLibraryCoversBase: env.OPEN_LIBRARY_COVERS_BASE ?? DEFAULT_CONFIG.openLibraryCoversBase,
  };
}

const getJson: GetJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  const json = response.ok ? await response.json().catch(() => null) : null;
  return { status: response.status, json };
};

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const safeFileName = (key: string) => key.replace(/[^a-z0-9._-]+/gi, "_");

/**
 * Downloads a cover once and keeps it in R2 (§2.2: never hotlink the source).
 * Returns the R2 key, or null if there's no usable image.
 */
async function storeCover(key: string, url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = await response.arrayBuffer();
    // Tiny images are "no cover" placeholders some services send instead of a 404.
    if (bytes.byteLength < 1000 || bytes.byteLength > COVER_MAX_BYTES) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    // Timestamped, so a replaced cover never collides with a cached old one.
    const r2Key = `covers/${safeFileName(key)}-${Date.now()}.${ext}`;
    await (await getBucket()).put(r2Key, bytes, { httpMetadata: { contentType: type } });
    return r2Key;
  } catch {
    return null;
  }
}

async function saveFound(key: string, data: EditionData) {
  const db = await getDb();
  // A cover photographed by hand is never replaced, so don't even fetch one.
  const byHand = await db.prepare("SELECT cover_by_hand FROM editions WHERE isbn13 = ?").bind(key).first<{ cover_by_hand: number }>();
  const cover = data.coverUrl && byHand?.cover_by_hand !== 1 ? await storeCover(key, data.coverUrl) : null;
  await db
    .prepare(
      `UPDATE editions SET
         title = ?, author = ?, publisher = ?, year = ?, edition = ?, language = ?,
         source = ?, cover_url = CASE WHEN cover_by_hand = 1 THEN cover_url ELSE COALESCE(?, cover_url) END, fetched_at = ?,
         lookup_status = 'found', lookup_attempts = lookup_attempts + 1, last_attempt_at = ?,
         search_text = ?
       WHERE isbn13 = ?`,
    )
    .bind(
      data.title,
      data.author,
      data.publisher,
      data.year,
      data.edition,
      data.language,
      data.source,
      cover,
      now(),
      now(),
      editionSearchText({ key, title: data.title, author: data.author, publisher: data.publisher }),
      key,
    )
    .run();
}

/**
 * Takes the edition for one lookup run, so two uploads arriving together
 * don't both look the same book up: only a pending edition not touched in
 * the last minute can be claimed.
 */
async function claim(key: string): Promise<{ lookup_attempts: number } | null> {
  const db = await getDb();
  const recently = new Date(Date.now() - 60_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE editions SET last_attempt_at = ?
       WHERE isbn13 = ? AND lookup_status = 'pending'
         AND (last_attempt_at IS NULL OR last_attempt_at < ?)`,
    )
    .bind(now(), key, recently)
    .run();
  if (result.meta.changes === 0) return null;
  return db.prepare("SELECT lookup_attempts FROM editions WHERE isbn13 = ?").bind(key).first<{ lookup_attempts: number }>();
}

/** Runs the lookup chain for one edition and records the outcome. */
export async function runLookup(key: string): Promise<LookupStatus | "retry" | "busy"> {
  const kind = editionKind(key);
  if (kind === "manual" || !kind) return "skipped";
  const row = await claim(key);
  if (!row) return "busy";
  const db = await getDb();

  const config = await lookupConfig();
  const result =
    kind === "finna"
      ? await lookupFinnaRecord(key.slice("finna:".length), getJson, config)
      : await lookupIsbn(key, getJson, config);

  if (result.outcome === "found") {
    await saveFound(key, result.data);
    return "found";
  }
  const givingUp = result.outcome === "not_found" || row.lookup_attempts + 1 >= MAX_ATTEMPTS;
  await db
    .prepare(
      `UPDATE editions SET lookup_attempts = lookup_attempts + 1, last_attempt_at = ?,
         lookup_status = ?, fetched_at = CASE WHEN ? THEN ? ELSE fetched_at END
       WHERE isbn13 = ?`,
    )
    .bind(now(), givingUp ? "not_found" : "pending", givingUp ? 1 : 0, now(), key)
    .run();
  return givingUp ? "not_found" : "retry";
}

/**
 * Looks up editions still pending: `first` straight away, then up to `limit`
 * others whose last try was long enough ago. Self-healing — any lookup that
 * failed for lack of signal on the services' side gets another go the next
 * time anything triggers this.
 */
export async function lookupPending({ first, limit = 3 }: { first?: string; limit?: number } = {}) {
  const db = await getDb();
  const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT isbn13 FROM editions
       WHERE lookup_status = 'pending' AND lookup_attempts < ?
         AND (last_attempt_at IS NULL OR last_attempt_at < ?)
       ORDER BY last_attempt_at IS NOT NULL, last_attempt_at
       LIMIT ?`,
    )
    .bind(MAX_ATTEMPTS, cutoff, limit)
    .all<{ isbn13: string }>();
  const keys = [...new Set([...(first ? [first] : []), ...results.map((r) => r.isbn13)])];
  for (const key of keys) {
    try {
      await runLookup(key);
    } catch (error) {
      console.error("lookup failed", key, error);
    }
  }
}

/** Runs pending lookups after the response has been sent. */
export async function kickLookups(first?: string) {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(lookupPending({ first }));
  } catch {
    // No execution context (e.g. during a build): nothing to do.
  }
}

export async function getEditions(keys: string[]): Promise<Edition[]> {
  if (keys.length === 0) return [];
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE isbn13 IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .all<EditionRow>();
  return results.map(toEdition);
}

/** Puts a not-found or pending edition back in line and looks it up now. */
export async function retryLookup(key: string) {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE editions SET lookup_status = 'pending', lookup_attempts = 0, last_attempt_at = NULL
       WHERE isbn13 = ? AND lookup_status IN ('pending', 'not_found')`,
    )
    .bind(key)
    .run();
  return runLookup(key);
}

export type EditionDetails = { title: string; author: string | null; year: number | null };

/**
 * Details typed in by hand — for a barcode-less book, or one no source knew.
 * Marked needs review (spec §2.2 open item); `reviewed` clears that.
 */
export async function saveEditionDetails(key: string, details: EditionDetails, { reviewed }: { reviewed: boolean }) {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE editions SET title = ?, author = ?, year = ?, source = 'manual',
         lookup_status = CASE WHEN lookup_status = 'found' THEN 'found' ELSE 'skipped' END,
         needs_review = ?, search_text = ?
       WHERE isbn13 = ?`,
    )
    .bind(
      details.title,
      details.author,
      details.year,
      reviewed ? 0 : 1,
      editionSearchText({ key, title: details.title, author: details.author }),
      key,
    )
    .run();
}

export async function markReviewed(key: string) {
  const db = await getDb();
  await db.prepare("UPDATE editions SET needs_review = 0 WHERE isbn13 = ?").bind(key).run();
}

/** After the phone's downscale a cover is ~200 KB; this is the ceiling. */
export const COVER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export class CoverError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * A cover photographed on the phone (docs/spec-corrections.md §15). Replaces
 * whatever cover the edition had — found or photographed — for every copy of
 * it, and marks it so a later lookup never swaps it back.
 */
export async function setCoverPhoto(key: string, type: string, body: ArrayBuffer): Promise<string> {
  const problem = imageProblem(type, body, COVER_PHOTO_MAX_BYTES);
  if (problem) throw new CoverError(problem);
  const db = await getDb();
  const row = await db
    .prepare("SELECT cover_url FROM editions WHERE isbn13 = ?")
    .bind(key)
    .first<{ cover_url: string | null }>();
  if (!row) throw new CoverError("This book isn't logged any more.", 404);

  const bucket = await getBucket();
  const r2Key = `covers/${safeFileName(key)}-${Date.now()}.${IMAGE_TYPES[type]}`;
  await bucket.put(r2Key, body, { httpMetadata: { contentType: type } });
  await db.prepare("UPDATE editions SET cover_url = ?, cover_by_hand = 1 WHERE isbn13 = ?").bind(r2Key, key).run();
  if (row.cover_url?.startsWith("covers/")) await bucket.delete(row.cover_url);
  return `/${r2Key}`;
}
