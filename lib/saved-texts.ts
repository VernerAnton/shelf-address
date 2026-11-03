import { getDb } from "@/lib/cloudflare";

/**
 * Saved texts (docs/spec-corrections.md §24): Extract's texts, kept so the
 * computer can pick them up. Only reachable with the access-code login
 * (the API routes check it). Deleted 30 days after their last change.
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
};

export class SavedTextError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const KEEP_DAYS = 30;
export const TEXT_MAX = 20000;

type Row = {
  id: string;
  text: string;
  source: "ai" | "phone";
  created_at: string;
  updated_at: string;
  done_at: string | null;
  edited_on_computer_at: string | null;
};
const fromRow = (r: Row): SavedText => ({
  id: r.id,
  text: r.text,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doneAt: r.done_at,
  editedOnComputerAt: r.edited_on_computer_at,
});

function validId(id: string) {
  if (!/^[\w-]{8,64}$/.test(id)) throw new SavedTextError("Bad id.");
}

function validTime(iso: unknown): string {
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) throw new SavedTextError("Bad time.");
  return new Date(iso).toISOString();
}

async function prune() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000).toISOString();
  await (await getDb()).prepare("DELETE FROM saved_texts WHERE updated_at < ?").bind(cutoff).run();
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
    await db.prepare("DELETE FROM saved_texts WHERE id = ?").bind(id).run();
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
    .prepare("SELECT * FROM saved_texts ORDER BY created_at DESC LIMIT ?")
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
  await (await getDb()).prepare("DELETE FROM saved_texts WHERE id = ?").bind(id).run();
}
