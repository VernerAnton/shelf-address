import { getBucket, getDb } from "@/lib/cloudflare";
import { BookOpsAiError, readBook, type Photo } from "@/lib/bookops-ai";
import {
  isCondition,
  missingForListing,
  parsePrice,
  type BookOpsBook,
  type DbSource,
  type FieldSource,
  type IsbnSource,
  type SourcedField,
} from "@/lib/bookops-model";
import { removeFromStore, sendToStore } from "@/lib/bookops-store";
import { getJson, lookupConfig } from "@/lib/editions";
import { IMAGE_TYPES, imageProblem } from "@/lib/images";
import { parseIsbn } from "@/lib/isbn";
import { lookupIsbn } from "@/lib/lookup/chain";

/**
 * BookOps on the server (docs/spec-corrections.md §30): books photographed
 * front and back, filled in from the book databases and by the AI, priced by
 * the person, then sent to the web store.
 *
 * Kept apart from the catalog on purpose: its own table (bookops_books) and
 * its own photos in R2 (bookops/…). Only reachable with the access-code login
 * (the API routes check it), like Saved texts.
 *
 * The filling-in ("work") never happens in the way of photographing: a book
 * is stored first, then `processBook` does whatever is still pending for it —
 * the lookup by ISBN and the AI reading side by side — and can be called
 * again at any time; a claim makes sure two calls don't do the same work.
 */

export class BookOpsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_URL = "/api/extract/bookops/photos/";
/** A claim older than this was left by a request that died: the work can be taken again. */
const WORK_STALE_MS = 90_000;
/** A lookup that couldn't reach the sources is tried this many times before giving up. */
const LOOKUP_ATTEMPTS = 3;
const LIMITS: Record<SourcedField | "location", number> = { title: 300, author: 300, publisher: 200, year: 20, description: 20000, location: 200 };

type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  status: "draft" | "listed";
  isbn13: string | null;
  isbn_source: IsbnSource | null;
  title: string | null;
  title_source: FieldSource | null;
  author: string | null;
  author_source: FieldSource | null;
  publisher: string | null;
  publisher_source: FieldSource | null;
  year: string | null;
  year_source: FieldSource | null;
  description: string | null;
  description_source: FieldSource | null;
  price_cents: number | null;
  condition: string | null;
  quantity: number;
  location: string | null;
  front_photo: string | null;
  back_photo: string | null;
  lookup_status: BookOpsBook["lookupStatus"];
  lookup_attempts: number;
  ai_status: BookOpsBook["aiStatus"];
  ai_note: string | null;
  work_started_at: string | null;
  listed_at: string | null;
  listing_ref: string | null;
};

const photoUrl = (key: string | null) => (key ? PHOTO_URL + key.slice("bookops/".length) : null);

const fromRow = (r: Row): BookOpsBook => ({
  id: r.id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  status: r.status,
  isbn13: r.isbn13,
  isbnSource: r.isbn_source,
  title: r.title,
  titleSource: r.title_source,
  author: r.author,
  authorSource: r.author_source,
  publisher: r.publisher,
  publisherSource: r.publisher_source,
  year: r.year,
  yearSource: r.year_source,
  description: r.description,
  descriptionSource: r.description_source,
  priceCents: r.price_cents,
  condition: isCondition(r.condition) ? r.condition : null,
  quantity: r.quantity,
  location: r.location,
  frontPhoto: photoUrl(r.front_photo),
  backPhoto: photoUrl(r.back_photo),
  lookupStatus: r.lookup_status,
  aiStatus: r.ai_status,
  aiNote: r.ai_note,
  listedAt: r.listed_at,
  listingRef: r.listing_ref,
});

const now = () => new Date().toISOString();

function validId(id: string) {
  if (!/^[\w-]{8,64}$/.test(id)) throw new BookOpsError("Bad id.");
}

async function rowOf(id: string): Promise<Row | null> {
  return (await getDb()).prepare("SELECT * FROM bookops_books WHERE id = ?").bind(id).first<Row>();
}

async function mustHave(id: string): Promise<Row> {
  validId(id);
  const row = await rowOf(id);
  if (!row) throw new BookOpsError("That book isn't in BookOps any more.", 404);
  return row;
}

/** Newest first. */
export async function listBooks(limit = 300): Promise<BookOpsBook[]> {
  const { results } = await (await getDb()).prepare("SELECT * FROM bookops_books ORDER BY created_at DESC LIMIT ?").bind(limit).all<Row>();
  return results.map(fromRow);
}

export type NewPhoto = { type: string; bytes: ArrayBuffer };

/**
 * A new book: photos of its front and back, the ISBN if the barcode was read
 * (or typed), or an ISBN alone. Stored at once; the filling-in is
 * `processBook`'s. Sending the same id again (a retry after a lost answer)
 * returns the book already stored.
 */
export async function createBook(input: {
  id: string;
  isbn?: string | null;
  isbnSource?: "barcode" | "typed";
  front?: NewPhoto | null;
  back?: NewPhoto | null;
}): Promise<BookOpsBook> {
  validId(input.id);
  const existing = await rowOf(input.id);
  if (existing) return fromRow(existing);

  let isbn13: string | null = null;
  if (input.isbn) {
    const parsed = parseIsbn(input.isbn);
    // A typed ISBN that's wrong is said so; a barcode that isn't a book's is just not an ISBN.
    if (parsed.ok) isbn13 = parsed.isbn13;
    else if (input.isbnSource === "typed") throw new BookOpsError(parsed.reason);
  }
  const photos = [input.front, input.back].filter((p): p is NewPhoto => Boolean(p));
  if (!isbn13 && photos.length === 0) throw new BookOpsError("A book needs photos or an ISBN.");
  for (const photo of photos) {
    const problem = imageProblem(photo.type, photo.bytes, PHOTO_MAX_BYTES);
    if (problem) throw new BookOpsError(problem, photo.bytes.byteLength > PHOTO_MAX_BYTES ? 413 : 400);
  }

  const bucket = await getBucket();
  const stamp = Date.now();
  const store = async (photo: NewPhoto | null | undefined, side: "front" | "back") => {
    if (!photo) return null;
    // Timestamped, so the address never shows an older photo from a cache.
    const key = `bookops/${input.id}-${side}-${stamp}.${IMAGE_TYPES[photo.type]}`;
    await bucket.put(key, photo.bytes, { httpMetadata: { contentType: photo.type } });
    return key;
  };
  const [front, back] = await Promise.all([store(input.front, "front"), store(input.back, "back")]);

  const at = now();
  await (await getDb())
    .prepare(
      `INSERT INTO bookops_books (id, created_at, updated_at, isbn13, isbn_source, front_photo, back_photo, lookup_status, ai_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(input.id, at, at, isbn13, isbn13 ? (input.isbnSource ?? "barcode") : null, front, back, isbn13 ? "pending" : "none", photos.length ? "pending" : "none")
    .run();
  return fromRow((await rowOf(input.id))!);
}

/** Fills a field in, if the rule allows (lib/bookops-model.ts `mayFill`): never over the person's text, a database over the AI. */
async function fill(id: string, field: SourcedField, value: string | null, source: DbSource | "ai") {
  const v = value?.trim();
  if (!v) return;
  // `field` is one of a fixed list, never the request's text.
  await (await getDb())
    .prepare(
      `UPDATE bookops_books SET ${field} = ?, ${field}_source = ?, updated_at = ?
       WHERE id = ? AND (${field}_source IS NULL OR (${field}_source = 'ai' AND ? <> 'ai'))`,
    )
    .bind(v.slice(0, LIMITS[field]), source, now(), id, source)
    .run();
}

/** Title, author, publisher and year from the book databases (Finna → Google Books → Open Library). */
async function lookUp(id: string, isbn13: string, attempts: number) {
  const db = await getDb();
  let outcome: "found" | "not_found" | "retry" = "retry";
  try {
    const result = await lookupIsbn(isbn13, getJson, await lookupConfig());
    outcome = result.outcome;
    if (result.outcome === "found") {
      const { data } = result;
      await fill(id, "title", data.title, data.source);
      await fill(id, "author", data.author, data.source);
      await fill(id, "publisher", data.publisher, data.source);
      await fill(id, "year", data.year ? String(data.year) : null, data.source);
    }
  } catch (error) {
    console.error("bookops lookup failed", id, error);
  }
  // The ISBN may have been changed meanwhile: then this answer isn't the last word.
  const status = outcome === "retry" ? (attempts + 1 >= LOOKUP_ATTEMPTS ? "not_found" : "pending") : outcome;
  await db
    .prepare("UPDATE bookops_books SET lookup_status = ?, lookup_attempts = lookup_attempts + 1, updated_at = ? WHERE id = ? AND isbn13 = ?")
    .bind(status, now(), id, isbn13)
    .run();
}

/** The AI's reading of the photos: the back-cover text, and what the barcode and the databases didn't give. */
async function readPhotos(row: Row) {
  const db = await getDb();
  try {
    const bucket = await getBucket();
    const photos: Photo[] = [];
    for (const [side, key] of [["front", row.front_photo], ["back", row.back_photo]] as const) {
      const object = key ? await bucket.get(key) : null;
      if (object) photos.push({ side, type: object.httpMetadata?.contentType ?? "image/jpeg", bytes: await object.arrayBuffer() });
    }
    const reading = await readBook(photos);
    await fill(row.id, "description", reading.description, "ai");
    await fill(row.id, "title", reading.title, "ai");
    await fill(row.id, "author", reading.author, "ai");
    if (reading.isbn13) {
      // Only where there's no ISBN yet: the barcode's, or a typed one, is better.
      await db
        .prepare("UPDATE bookops_books SET isbn13 = ?, isbn_source = 'ai', lookup_status = 'pending', lookup_attempts = 0 WHERE id = ? AND isbn13 IS NULL")
        .bind(reading.isbn13, row.id)
        .run();
    }
    await db.prepare("UPDATE bookops_books SET ai_status = 'done', ai_note = NULL, updated_at = ? WHERE id = ?").bind(now(), row.id).run();
  } catch (error) {
    if (!(error instanceof BookOpsAiError)) console.error("bookops reading failed", row.id, error);
    const note = error instanceof BookOpsAiError ? error.message : "The AI couldn't read it.";
    await db.prepare("UPDATE bookops_books SET ai_status = 'failed', ai_note = ?, updated_at = ? WHERE id = ?").bind(note, now(), row.id).run();
  }
}

/**
 * Does whatever is still pending for a book: the lookup by ISBN and the AI
 * reading, side by side; then the lookup once more if the AI is what found
 * the ISBN. Safe to call any number of times, from the screen that added the
 * book and from any screen that notices it still waiting. `retry` first puts
 * a failed reading (or an ISBN no source knew) back in line.
 */
export async function processBook(id: string, { retry = false } = {}): Promise<BookOpsBook> {
  await mustHave(id);
  const db = await getDb();
  if (retry) {
    await db
      .prepare(
        `UPDATE bookops_books SET
           ai_status = CASE WHEN ai_status = 'failed' AND (front_photo IS NOT NULL OR back_photo IS NOT NULL) THEN 'pending' ELSE ai_status END,
           lookup_status = CASE WHEN lookup_status = 'not_found' AND isbn13 IS NOT NULL THEN 'pending' ELSE lookup_status END,
           lookup_attempts = 0
         WHERE id = ?`,
      )
      .bind(id)
      .run();
  }
  const stale = new Date(Date.now() - WORK_STALE_MS).toISOString();
  const claim = await db
    .prepare(
      `UPDATE bookops_books SET work_started_at = ?
       WHERE id = ? AND (lookup_status = 'pending' OR ai_status = 'pending') AND (work_started_at IS NULL OR work_started_at < ?)`,
    )
    .bind(now(), id, stale)
    .run();
  if (claim.meta.changes) {
    try {
      const row = (await rowOf(id))!;
      await Promise.all([
        row.lookup_status === "pending" && row.isbn13 ? lookUp(id, row.isbn13, row.lookup_attempts) : null,
        row.ai_status === "pending" ? readPhotos(row) : null,
      ]);
      const after = await rowOf(id);
      // The AI found the ISBN (or it was typed meanwhile): look that up too.
      if (after?.lookup_status === "pending" && after.isbn13 && after.isbn13 !== row.isbn13) await lookUp(id, after.isbn13, after.lookup_attempts);
    } finally {
      await db.prepare("UPDATE bookops_books SET work_started_at = NULL WHERE id = ?").bind(id).run();
    }
  }
  return fromRow((await rowOf(id))!);
}

/**
 * What the person typed at the desk. A sourced field becomes theirs ("you")
 * and is never filled in again. An ISBN typed here is looked up
 * (`processBook` afterwards). Refused once the book is in the web store.
 */
export async function editBook(id: string, patch: Record<string, unknown>): Promise<BookOpsBook> {
  const row = await mustHave(id);
  if (row.status === "listed") throw new BookOpsError("This book is in the web store. Take it back to change it.", 409);
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (sql: string, ...v: unknown[]) => {
    sets.push(sql);
    values.push(...v);
  };

  for (const field of ["title", "author", "publisher", "year", "description"] as const) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (typeof value !== "string") throw new BookOpsError(`Bad ${field}.`);
    if (value.length > LIMITS[field]) throw new BookOpsError(`That ${field} is too long.`, 413);
    set(`${field} = ?, ${field}_source = 'you'`, value);
  }
  if ("location" in patch) {
    if (typeof patch.location !== "string" || patch.location.length > LIMITS.location) throw new BookOpsError("Bad location.");
    set("location = ?", patch.location);
  }
  if ("price" in patch) {
    const cents = typeof patch.price === "string" ? parsePrice(patch.price) : "bad";
    if (cents === "bad") throw new BookOpsError("That isn't a price. Write it like 14,50.");
    set("price_cents = ?", cents);
  }
  if ("condition" in patch) {
    if (patch.condition !== null && !isCondition(patch.condition)) throw new BookOpsError("Bad condition.");
    set("condition = ?", patch.condition);
  }
  if ("quantity" in patch) {
    const n = Number(patch.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 999) throw new BookOpsError("Copies must be a whole number, 1 or more.");
    set("quantity = ?", n);
  }
  if ("isbn" in patch) {
    if (typeof patch.isbn !== "string") throw new BookOpsError("Bad ISBN.");
    if (!patch.isbn.trim()) set("isbn13 = NULL, isbn_source = NULL, lookup_status = 'none'");
    else {
      const parsed = parseIsbn(patch.isbn);
      if (!parsed.ok) throw new BookOpsError(parsed.reason);
      if (parsed.isbn13 !== row.isbn13) set("isbn13 = ?, isbn_source = 'you', lookup_status = 'pending', lookup_attempts = 0", parsed.isbn13);
    }
  }
  if (sets.length) {
    await (await getDb())
      .prepare(`UPDATE bookops_books SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...values, now(), id)
      .run();
  }
  return fromRow((await rowOf(id))!);
}

/**
 * Photos for a book already in the queue — one scanned by ISBN, or one whose
 * back cover was photographed on a phone — taken on the computer. Only the
 * sides it doesn't have yet are stored; the AI then reads the book again (it
 * fills in only what's still empty, as always). The barcode read from a new
 * back photo gives the book its ISBN if it had none.
 */
export async function attachPhotos(
  id: string,
  input: { front?: NewPhoto | null; back?: NewPhoto | null; isbn?: string | null },
): Promise<BookOpsBook> {
  const row = await mustHave(id);
  if (row.status === "listed") throw new BookOpsError("This book is in the web store. Take it back to change it.", 409);
  const front = row.front_photo ? null : (input.front ?? null);
  const back = row.back_photo ? null : (input.back ?? null);
  if (!front && !back) throw new BookOpsError("This book already has those photos.", 409);
  for (const photo of [front, back]) {
    if (!photo) continue;
    const problem = imageProblem(photo.type, photo.bytes, PHOTO_MAX_BYTES);
    if (problem) throw new BookOpsError(problem, photo.bytes.byteLength > PHOTO_MAX_BYTES ? 413 : 400);
  }
  const bucket = await getBucket();
  const stamp = Date.now();
  const store = async (photo: NewPhoto | null, side: "front" | "back") => {
    if (!photo) return null;
    const key = `bookops/${id}-${side}-${stamp}.${IMAGE_TYPES[photo.type]}`;
    await bucket.put(key, photo.bytes, { httpMetadata: { contentType: photo.type } });
    return key;
  };
  const [frontKey, backKey] = await Promise.all([store(front, "front"), store(back, "back")]);
  const parsed = input.isbn ? parseIsbn(input.isbn) : null;
  const isbn13 = parsed?.ok ? parsed.isbn13 : null;
  const db = await getDb();
  await db
    .prepare(
      `UPDATE bookops_books SET
         front_photo = COALESCE(front_photo, ?), back_photo = COALESCE(back_photo, ?),
         ai_status = 'pending', ai_note = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(frontKey, backKey, now(), id)
    .run();
  if (isbn13) {
    await db
      .prepare("UPDATE bookops_books SET isbn13 = ?, isbn_source = 'barcode', lookup_status = 'pending', lookup_attempts = 0 WHERE id = ? AND isbn13 IS NULL")
      .bind(isbn13, id)
      .run();
  }
  return fromRow((await rowOf(id))!);
}

/** How many other books still to do have this ISBN (a second copy, or a double scan). */
export async function sameIsbnCount(book: BookOpsBook): Promise<number> {
  if (!book.isbn13) return 0;
  const row = await (await getDb())
    .prepare("SELECT COUNT(*) AS n FROM bookops_books WHERE isbn13 = ? AND id <> ? AND status = 'draft'")
    .bind(book.isbn13, book.id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Removes a book and its photos. Refused while it's in the web store. */
export async function deleteBook(id: string): Promise<void> {
  validId(id);
  const row = await rowOf(id);
  if (!row) return;
  if (row.status === "listed") throw new BookOpsError("This book is in the web store. Take it back first.", 409);
  await (await getDb()).prepare("DELETE FROM bookops_books WHERE id = ?").bind(id).run();
  const bucket = await getBucket();
  for (const key of [row.front_photo, row.back_photo]) if (key) await bucket.delete(key);
}

/**
 * Sends the book to the web store exactly as it stands (lib/bookops-store.ts
 * — a stand-in for now). Needs a title, a price and a condition.
 */
export async function sendBook(id: string): Promise<BookOpsBook> {
  const row = await mustHave(id);
  if (row.status === "listed") return fromRow(row);
  const book = fromRow(row);
  const missing = missingForListing(book);
  if (missing.length) throw new BookOpsError(`Add ${missing.join(" and ")} first.`);
  const { ref } = await sendToStore({
    id,
    isbn13: row.isbn13,
    title: row.title!.trim(),
    author: row.author,
    publisher: row.publisher,
    year: row.year,
    description: row.description,
    priceCents: row.price_cents!,
    condition: row.condition!,
    quantity: row.quantity,
    photo: row.front_photo,
  });
  const at = now();
  await (await getDb())
    .prepare("UPDATE bookops_books SET status = 'listed', listed_at = ?, listing_ref = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(at, ref, at, id)
    .run();
  return fromRow((await rowOf(id))!);
}

/** Takes the book back out of the web store, to change it. */
export async function takeBackBook(id: string): Promise<BookOpsBook> {
  const row = await mustHave(id);
  if (row.status !== "listed") return fromRow(row);
  if (row.listing_ref) await removeFromStore(row.listing_ref);
  await (await getDb())
    .prepare("UPDATE bookops_books SET status = 'draft', listed_at = NULL, listing_ref = NULL, updated_at = ? WHERE id = ?")
    .bind(now(), id)
    .run();
  return fromRow((await rowOf(id))!);
}

/** A stored photo, by the file part of its address. */
export async function getPhoto(file: string): Promise<R2ObjectBody | null> {
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(file)) return null;
  return (await getBucket()).get(`bookops/${file}`);
}
