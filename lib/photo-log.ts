import { getBucket, getDb } from "@/lib/cloudflare";
import { IMAGE_TYPES, looksLike } from "@/lib/images";

/**
 * Photo log (docs/spec-corrections.md §21): photos taken with "Camera
 * struggling? Take a photo", kept with what the app made of each, so failures
 * can be looked at afterwards. Troubleshooting data, deleted after 30 days.
 */

export const OUTCOMES = ["barcode", "isbn", "several", "none", "error", "lost"] as const;
export type PhotoOutcome = (typeof OUTCOMES)[number];

export type PhotoLogMeta = {
  id: string;
  takenAt: string;
  screen: string;
  outcome: PhotoOutcome;
  isbns: string[];
  error: string | null;
  ocrText: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  userAgent: string | null;
  appVersion: number | null;
};

export type PhotoLogEntry = PhotoLogMeta & { uploadedAt: string; hasPhoto: boolean; hasThumb: boolean };

export class PhotoLogError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const KEEP_DAYS = 30;
const PHOTO_MAX_BYTES = 30 * 1024 * 1024;
const THUMB_MAX_BYTES = 1024 * 1024;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** The entry as sent by the phone, checked; throws PhotoLogError if it can't be stored. */
export function parseMeta(raw: unknown): PhotoLogMeta {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = text(m.id, 64);
  if (!id || !/^[\w-]{8,64}$/.test(id)) throw new PhotoLogError("Bad entry id.");
  const takenAt = text(m.takenAt, 40);
  if (!takenAt || Number.isNaN(Date.parse(takenAt))) throw new PhotoLogError("Bad time.");
  if (!OUTCOMES.includes(m.outcome as PhotoOutcome)) throw new PhotoLogError("Bad outcome.");
  return {
    id,
    takenAt,
    screen: text(m.screen, 100) ?? "",
    outcome: m.outcome as PhotoOutcome,
    isbns: Array.isArray(m.isbns) ? m.isbns.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, 20) : [],
    error: text(m.error, 2000),
    ocrText: text(m.ocrText, 20000),
    durationMs: int(m.durationMs),
    width: int(m.width),
    height: int(m.height),
    bytes: int(m.bytes),
    mime: text(m.mime, 100),
    userAgent: text(m.userAgent, 500),
    appVersion: int(m.appVersion),
  };
}

function imageType(file: File | null, maxBytes: number): string | null {
  if (!file) return null;
  if (file.size > maxBytes) throw new PhotoLogError("That photo is too large to keep.", 413);
  return file.type;
}

/** Stores an entry and its photos. Sending the same entry again is harmless. */
export async function addPhotoLog(meta: PhotoLogMeta, photo: File | null, thumb: File | null): Promise<void> {
  const db = await getDb();
  const exists = await db.prepare("SELECT 1 FROM photo_log WHERE id = ?").bind(meta.id).first();
  if (exists) return;

  const bucket = await getBucket();
  const store = async (file: File | null, maxBytes: number, suffix: string) => {
    const type = imageType(file, maxBytes);
    if (!file || !type) return null;
    const bytes = await file.arrayBuffer();
    // Odd formats (HEIC from an iPhone) are kept as they are; they're still worth looking at.
    const ext = IMAGE_TYPES[type] && looksLike(type, new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength))) ? IMAGE_TYPES[type] : "bin";
    const key = `photo-log/${meta.id}${suffix}.${ext}`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: ext === "bin" ? type || "application/octet-stream" : type } });
    return key;
  };
  const photoKey = await store(photo, PHOTO_MAX_BYTES, "");
  const thumbKey = await store(thumb, THUMB_MAX_BYTES, "-thumb");

  await db
    .prepare(
      `INSERT OR IGNORE INTO photo_log (id, taken_at, uploaded_at, screen, outcome, isbns, error, ocr_text, duration_ms,
         width, height, bytes, mime, user_agent, app_version, photo_key, thumb_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      meta.id,
      meta.takenAt,
      new Date().toISOString(),
      meta.screen,
      meta.outcome,
      JSON.stringify(meta.isbns),
      meta.error,
      meta.ocrText,
      meta.durationMs,
      meta.width,
      meta.height,
      meta.bytes,
      meta.mime,
      meta.userAgent,
      meta.appVersion,
      photoKey,
      thumbKey,
    )
    .run();
  await pruneOld();
}

/** Deletes entries (and their photos) older than 30 days, a batch at a time. */
async function pruneOld() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  const { results } = await db
    .prepare("SELECT id, photo_key, thumb_key FROM photo_log WHERE taken_at < ? LIMIT 50")
    .bind(cutoff)
    .all<{ id: string; photo_key: string | null; thumb_key: string | null }>();
  if (!results.length) return;
  const keys = results.flatMap((r) => [r.photo_key, r.thumb_key]).filter((k): k is string => Boolean(k));
  if (keys.length) await (await getBucket()).delete(keys);
  await db.batch(results.map((r) => db.prepare("DELETE FROM photo_log WHERE id = ?").bind(r.id)));
}

type Row = {
  id: string;
  taken_at: string;
  uploaded_at: string;
  screen: string;
  outcome: PhotoOutcome;
  isbns: string;
  error: string | null;
  ocr_text: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  user_agent: string | null;
  app_version: number | null;
  photo_key: string | null;
  thumb_key: string | null;
};

function fromRow(r: Row): PhotoLogEntry {
  let isbns: string[] = [];
  try {
    isbns = JSON.parse(r.isbns);
  } catch {
    // leave empty
  }
  return {
    id: r.id,
    takenAt: r.taken_at,
    uploadedAt: r.uploaded_at,
    screen: r.screen,
    outcome: r.outcome,
    isbns,
    error: r.error,
    ocrText: r.ocr_text,
    durationMs: r.duration_ms,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    mime: r.mime,
    userAgent: r.user_agent,
    appVersion: r.app_version,
    hasPhoto: Boolean(r.photo_key),
    hasThumb: Boolean(r.thumb_key),
  };
}

/** Newest first. */
export async function listPhotoLog(limit = 200): Promise<PhotoLogEntry[]> {
  const { results } = await (await getDb())
    .prepare("SELECT * FROM photo_log ORDER BY taken_at DESC LIMIT ?")
    .bind(limit)
    .all<Row>();
  return results.map(fromRow);
}

/** The stored photo or its thumbnail, or null. */
export async function photoLogImage(id: string, kind: "photo" | "thumb"): Promise<R2ObjectBody | null> {
  const row = await (await getDb())
    .prepare("SELECT photo_key, thumb_key FROM photo_log WHERE id = ?")
    .bind(id)
    .first<{ photo_key: string | null; thumb_key: string | null }>();
  const key = kind === "photo" ? row?.photo_key : row?.thumb_key;
  return key ? (await getBucket()).get(key) : null;
}

export async function deletePhotoLog(id: string): Promise<void> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT photo_key, thumb_key FROM photo_log WHERE id = ?")
    .bind(id)
    .first<{ photo_key: string | null; thumb_key: string | null }>();
  if (!row) return;
  const keys = [row.photo_key, row.thumb_key].filter((k): k is string => Boolean(k));
  if (keys.length) await (await getBucket()).delete(keys);
  await db.prepare("DELETE FROM photo_log WHERE id = ?").bind(id).run();
}
