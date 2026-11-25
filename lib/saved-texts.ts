import { getBucket, getDb } from "@/lib/cloudflare";
import { imageProblem, IMAGE_TYPES } from "@/lib/images";
import { addPhotoLog } from "@/lib/photo-log";
import type { AiDetails } from "@/lib/extract-ai";
import { APP_VERSION } from "@/lib/version";

/**
 * Saved texts (docs/spec-corrections.md §24): Extract's texts, kept so the
 * computer can pick them up. Only reachable with the access-code login
 * (the API routes check it). Deleted 7 days after their last change
 * (30 until V27).
 *
 * Since V28 (§28) a text can have its book's front cover (photographed on the
 * phone, to copy into a listing on the computer) and keeps the back-cover
 * photos the AI read for it, so a bad reading can be reported from the
 * computer. Photos are in R2 under saved-texts/<id>/ and go with the text.
 */

export type SavedText = {
  id: string;
  text: string;
  source: "ai" | "phone";
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  /** Corrected on the computer: from then on, the computer's version wins. */
  editedOnComputerAt: string | null;
  /** When the front cover was photographed, or null if it hasn't been. */
  coverAt: string | null;
  /** How many back-cover photos the AI read for it (kept for reporting). */
  readings: number;
  /** How long the AI took for each of them, in ms, oldest first (V33.1). */
  aiMs: number[];
};

export class SavedTextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const KEEP_DAYS = 7;
export const TEXT_MAX = 20000;

type Row = {
  id: string;
  text: string;
  source: "ai" | "phone";
  created_at: string;
  updated_at: string;
  done_at: string | null;
  edited_on_computer_at: string | null;
  cover_key: string | null;
  cover_at: string | null;
  readings: number;
  ai_ms: string | null;
};
const fromRow = (r: Row): SavedText => ({
  id: r.id,
  text: r.text,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
  editedOnComputerAt: r.edited_on_computer_at,
  coverAt: r.cover_key ? r.cover_at : null,
  readings: r.readings ?? 0,
  aiMs: (r.ai_ms ?? "").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0),
});

function validId(id: string) {
  if (!/^[\w-]{8,64}$/.test(id)) throw new SavedTextError("Bad id.");
}

function validTime(iso: unknown): string {
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) throw new SavedTextError("Bad time.");
  return new Date(iso).toISOString();
}

/** Deletes texts with their readings and every photo of theirs in R2. */
async function removeTexts(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const marks = ids.map(() => "?").join(",");
  const covers = await db.prepare(`SELECT cover_key AS k FROM saved_texts WHERE id IN (${marks})`).bind(...ids).all<{ k: string | null }>();
  const photos = await db.prepare(`SELECT photo_key AS k FROM saved_text_readings WHERE text_id IN (${marks})`).bind(...ids).all<{ k: string | null }>();
  const keys = [...covers.results, ...photos.results].map((r) => r.k).filter((k): k is string => Boolean(k));
  if (keys.length) await (await getBucket()).delete(keys);
  await db.batch([
    db.prepare(`DELETE FROM saved_text_readings WHERE text_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM saved_texts WHERE id IN (${marks})`).bind(...ids),
  ]);
}

async function prune() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  const { results } = await db.prepare("SELECT id FROM saved_texts WHERE updated_at < ? LIMIT 50").bind(cutoff).all<{ id: string }>();
  await removeTexts(results.map((r) => r.id));
  // Readings whose text never arrived (the phone read it, then cleared it before it was saved).
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const orphans = await db
    .prepare("SELECT id, photo_key FROM saved_text_readings WHERE read_at < ? AND text_id NOT IN (SELECT id FROM saved_texts) LIMIT 50")
    .bind(dayAgo)
    .all<{ id: string; photo_key: string | null }>();
  if (orphans.results.length) {
    const keys = orphans.results.map((r) => r.photo_key).filter((k): k is string => Boolean(k));
    if (keys.length) await (await getBucket()).delete(keys);
    await db.batch(orphans.results.map((r) => db.prepare("DELETE FROM saved_text_readings WHERE id = ?").bind(r.id)));
  }
}

export type SaveResult = "saved" | "older" | "editedOnComputer";

/**
 * Saves a text from the phone (new, or a newer version of one already saved).
 * An empty text deletes it. Refused if a newer version is already there, or
 * if it has been corrected on the computer since (the computer's wins).
 */
export async function saveText(id: string, body: { text?: unknown; source?: unknown; createdAt?: unknown; updatedAt?: unknown }): Promise<SaveResult> {
  validId(id);
  if (typeof body.text !== "string") throw new SavedTextError("Bad text.");
  if (body.text.length > TEXT_MAX) throw new SavedTextError("That text is too long.", 413);
  const source = body.source === "phone" ? "phone" : "ai";
  const updatedAt = validTime(body.updatedAt);
  const createdAt = body.createdAt === undefined ? updatedAt : validTime(body.createdAt);
  const db = await getDb();
  const existing = await db
    .prepare("SELECT updated_at, edited_on_computer_at FROM saved_texts WHERE id = ?")
    .bind(id)
    .first<{ updated_at: string; edited_on_computer_at: string | null }>();
  if (existing?.edited_on_computer_at) return "editedOnComputer";
  if (existing && existing.updated_at > updatedAt) return "older";
  const text = body.text.trim();
  if (!text) {
    await removeTexts([id]);
    return "saved";
  }
  await db
    .prepare(
      `INSERT INTO saved_texts (id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET text = excluded.text, source = excluded.source, updated_at = excluded.updated_at`,
    )
    .bind(id, text, source, createdAt, updatedAt)
    .run();
  await prune();
  return "saved";
}

/** A correction made on the computer. From now on the phone can't overwrite it. */
export async function editOnComputer(id: string, text: unknown): Promise<void> {
  validId(id);
  if (typeof text !== "string" || !text.trim()) throw new SavedTextError("The text can't be empty — use Delete instead.");
  if (text.length > TEXT_MAX) throw new SavedTextError("That text is too long.", 413);
  const now = new Date().toISOString();
  const { meta } = await (await getDb())
    .prepare("UPDATE saved_texts SET text = ?, updated_at = ?, edited_on_computer_at = ? WHERE id = ?")
    .bind(text.trim(), now, now, id)
    .run();
  if (!meta.changes) throw new SavedTextError("That text isn't there any more.", 404);
}

/** Newest first. */
export async function listTexts(limit = 200): Promise<SavedText[]> {
  await prune();
  const { results } = await (await getDb())
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM saved_text_readings r WHERE r.text_id = t.id) AS readings,
         (SELECT group_concat(ms) FROM (
            SELECT CAST(json_extract(r.details, '$.ms') AS INTEGER) AS ms FROM saved_text_readings r
            WHERE r.text_id = t.id ORDER BY r.read_at)) AS ai_ms
       FROM saved_texts t ORDER BY t.created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Row>();
  return results.map(fromRow);
}

export async function setDone(id: string, done: boolean): Promise<void> {
  validId(id);
  await (await getDb())
    .prepare("UPDATE saved_texts SET done_at = ? WHERE id = ?")
    .bind(done ? new Date().toISOString() : null, id)
    .run();
}

export async function deleteText(id: string): Promise<void> {
  validId(id);
  await removeTexts([id]);
}

/** Front covers arrive made smaller on the phone (1600 px); this is plenty. */
export const COVER_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Stores the front cover for a text, replacing any earlier one. A new key each
 * time, so a computer showing the old picture can't keep it from its cache.
 * Throws 404 if the text isn't on the server (yet).
 */
export async function setCover(id: string, type: string, body: ArrayBuffer): Promise<void> {
  validId(id);
  const problem = imageProblem(type, body, COVER_MAX_BYTES);
  if (problem) throw new SavedTextError(problem, 415);
  const db = await getDb();
  const row = await db.prepare("SELECT cover_key FROM saved_texts WHERE id = ?").bind(id).first<{ cover_key: string | null }>();
  if (!row) throw new SavedTextError("That text isn't on the server.", 404);
  const bucket = await getBucket();
  const at = new Date().toISOString();
  const key = `saved-texts/${id}/cover-${Date.now()}.${IMAGE_TYPES[type]}`;
  await bucket.put(key, body, { httpMetadata: { contentType: type } });
  await db.prepare("UPDATE saved_texts SET cover_key = ?, cover_at = ? WHERE id = ?").bind(key, at, id).run();
  if (row.cover_key) await bucket.delete(row.cover_key);
}

/** The front cover picture, or null. */
export async function getCover(id: string): Promise<R2ObjectBody | null> {
  validId(id);
  const row = await (await getDb()).prepare("SELECT cover_key FROM saved_texts WHERE id = ?").bind(id).first<{ cover_key: string | null }>();
  return row?.cover_key ? (await getBucket()).get(row.cover_key) : null;
}

/**
 * Keeps a back-cover photo the AI read for a text, with its answer. Called by
 * the reading itself, so the text may not be on the server yet; one that
 * never arrives is cleared a day later.
 */
export async function addReading(
  textId: string,
  photo: ArrayBuffer,
  type: string,
  reply: string,
  details: AiDetails,
  readingId?: string | null,
): Promise<void> {
  validId(textId);
  // The phone names the reading (V31), so it can ask for the answer again if it never arrived.
  const id = readingId && /^[\w-]{8,64}$/.test(readingId) ? readingId : crypto.randomUUID();
  const key = `saved-texts/${textId}/reading-${id}.${IMAGE_TYPES[type] ?? "jpg"}`;
  await (await getBucket()).put(key, photo, { httpMetadata: { contentType: type } });
  await (await getDb())
    .prepare("INSERT OR IGNORE INTO saved_text_readings (id, text_id, read_at, photo_key, reply, details) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, textId, new Date().toISOString(), key, reply, JSON.stringify(details))
    .run();
}

/**
 * A reading's answer, by the id the phone gave it (V31): for a phone whose
 * answer got lost (the browser put the page to sleep while the camera was
 * open for the front cover, say). Null if there's no such reading (yet).
 */
export async function getReading(id: string): Promise<{ text: string; details: AiDetails | null } | null> {
  validId(id);
  const row = await (await getDb())
    .prepare("SELECT reply, details FROM saved_text_readings WHERE id = ?")
    .bind(id)
    .first<{ reply: string; details: string | null }>();
  if (!row) return null;
  let details: AiDetails | null = null;
  try {
    details = row.details ? (JSON.parse(row.details) as AiDetails) : null;
  } catch {
    // leave out
  }
  return { text: row.reply, details };
}

type ReadingRow = { id: string; read_at: string; photo_key: string | null; reply: string; details: string | null };

/** Same wording as the phone's reports (app/extract/extract-screen.tsx). */
function describe(d: AiDetails | null): string {
  if (!d) return "Read by: AI";
  const n = (v: number | null) => (v == null ? "?" : v.toLocaleString("en-GB"));
  return [
    `Read by: AI (${d.model})`,
    `Stopped because: ${d.finishReason ?? "not said"}${d.finishReason === "length" ? " — ran out of room, the end is missing" : ""}`,
    `Tokens: photo and instructions ${n(d.promptTokens)}, answer ${n(d.answerTokens)} of at most ${n(d.maxTokens)}${d.thinkingTokens != null ? ` (thinking ${n(d.thinkingTokens)})` : ""}`,
    `AI took: ${(d.ms / 1000).toFixed(1)} s${d.provider ? `, served by ${d.provider}` : ""}${d.thinking ? `, thinking: ${d.thinking}` : ""}`,
  ].join("\n");
}

/**
 * A problem reported from the computer: each back-cover photo the AI read for
 * the text goes to the Photo log (§21) with what came back, the text as it is
 * now and the note. A text with no readings (read by the phone) still gets
 * one entry, without a photo.
 */
export async function reportText(id: string, note: unknown, userAgent: string | null): Promise<number> {
  validId(id);
  const db = await getDb();
  const text = await db.prepare("SELECT text, source FROM saved_texts WHERE id = ?").bind(id).first<{ text: string; source: string }>();
  if (!text) throw new SavedTextError("That text isn't there any more.", 404);
  const said = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  const { results } = await db
    .prepare("SELECT id, read_at, photo_key, reply, details FROM saved_text_readings WHERE text_id = ? ORDER BY read_at LIMIT 10")
    .bind(id)
    .all<ReadingRow>();
  const readings: (ReadingRow | null)[] = results.length ? results : [null];
  const bucket = await getBucket();
  let n = 0;
  for (const r of readings) {
    let photo: File | null = null;
    if (r?.photo_key) {
      const object = await bucket.get(r.photo_key);
      if (object) photo = new File([await object.arrayBuffer()], "photo", { type: object.httpMetadata?.contentType ?? "image/jpeg" });
    }
    let details: AiDetails | null = null;
    try {
      details = r?.details ? (JSON.parse(r.details) as AiDetails) : null;
    } catch {
      // leave out
    }
    const part = readings.length > 1 ? ` (photo ${++n} of ${readings.length})` : "";
    await addPhotoLog(
      {
        id: crypto.randomUUID(),
        takenAt: r?.read_at ?? new Date().toISOString(),
        screen: "/extract/saved",
        outcome: "error",
        isbns: [],
        error: (said ? `Reported on the computer: ${said}` : "Reported on the computer (no note)") + part,
        ocrText: [
          "Reported on the computer",
          `Note: ${said || "(none)"}`,
          r ? describe(details) : "Read by: the phone's own reader — no photo reached the server",
          "",
          "— What came back —",
          r ? r.reply || "(nothing)" : "(not kept)",
          "",
          "— The text now —",
          text.text,
        ].join("\n"),
        durationMs: details?.ms ?? null,
        width: null,
        height: null,
        bytes: photo?.size ?? null,
        mime: photo?.type ?? null,
        userAgent,
        appVersion: Number(APP_VERSION),
      },
      photo,
      null,
    );
  }
  return readings.length;
}
