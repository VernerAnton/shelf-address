import { isCondition, type Condition } from "@/lib/copy-model";

/**
 * BookOps rules shared by the server and the screen (no server imports).
 * docs/spec-corrections.md §30.
 *
 * A book photographed for BookOps is filled in from three places: the book
 * databases (by ISBN), the AI (read off the photos), and the person. Each
 * field remembers which, and the rule is: a field fills itself in only while
 * nobody has typed in it. What the person typed is never overwritten; what
 * the AI read gives way to a database; a database's answer stays.
 */

export type DbSource = "finna" | "google_books" | "open_library";
export type FieldSource = DbSource | "ai" | "you";
export type IsbnSource = "barcode" | "typed" | "ai" | "you";

/** The fields that fill themselves in, each with a source. */
export const SOURCED_FIELDS = ["title", "author", "publisher", "year", "description"] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];

export type BookOpsBook = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** draft: being worked on; listed: sent to the web store. */
  status: "draft" | "listed";
  isbn13: string | null;
  isbnSource: IsbnSource | null;
  title: string | null;
  titleSource: FieldSource | null;
  author: string | null;
  authorSource: FieldSource | null;
  publisher: string | null;
  publisherSource: FieldSource | null;
  year: string | null;
  yearSource: FieldSource | null;
  description: string | null;
  descriptionSource: FieldSource | null;
  priceCents: number | null;
  condition: Condition | null;
  quantity: number;
  location: string | null;
  /** Where the photos can be loaded from, or null for a book added by ISBN alone. */
  frontPhoto: string | null;
  backPhoto: string | null;
  lookupStatus: "none" | "pending" | "found" | "not_found";
  aiStatus: "none" | "pending" | "done" | "failed";
  /** Why the AI couldn't read it, when it couldn't. */
  aiNote: string | null;
  listedAt: string | null;
  listingRef: string | null;
};

/** May a value from `incoming` replace what's there (from `current`)? */
export function mayFill(current: FieldSource | null, incoming: FieldSource): boolean {
  if (current === null) return true;
  if (current === "you") return false;
  return current === "ai" && incoming !== "ai" && incoming !== "you";
}

/**
 * A typed price in euros → cents. Finnish and English decimals ("14,50",
 * "14.5"), with or without a € sign. Empty is "no price yet" (null);
 * anything else that isn't a price is "bad".
 */
export function parsePrice(text: string): number | null | "bad" {
  const t = text.replace(/[€\s]/g, "");
  if (!t) return null;
  const match = /^(\d{1,6})(?:[.,](\d{0,2}))?$/.exec(t);
  if (!match) return "bad";
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Cents → "14,50", the way prices are written in Finland. */
export function formatPrice(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** Still being looked up or read. */
export const isWorking = (book: Pick<BookOpsBook, "lookupStatus" | "aiStatus">) =>
  book.lookupStatus === "pending" || book.aiStatus === "pending";

/** Title or author came from the AI's reading of the cover: worth a look before listing. */
export const needsCheck = (book: Pick<BookOpsBook, "titleSource" | "authorSource" | "isbnSource">) =>
  book.titleSource === "ai" || book.authorSource === "ai" || book.isbnSource === "ai";

/** What's still missing before the book can be sent to the web store, in words. */
export function missingForListing(book: Pick<BookOpsBook, "title" | "priceCents" | "condition">): string[] {
  const missing: string[] = [];
  if (!book.title?.trim()) missing.push("a title");
  if (book.priceCents === null) missing.push("a price");
  if (!book.condition) missing.push("a condition");
  return missing;
}

export type QueueState = "listed" | "reading" | "price" | "ready";

/** The one label a book gets in the queue. */
export function queueState(book: BookOpsBook): QueueState {
  if (book.status === "listed") return "listed";
  if (isWorking(book)) return "reading";
  return missingForListing(book).length ? "price" : "ready";
}

export const QUEUE_LABEL: Record<QueueState, string> = {
  listed: "Listed",
  reading: "Reading…",
  price: "To price",
  ready: "Ready to send",
};

/** How a field's source is shown beside its label. */
export function sourceLabel(source: FieldSource | IsbnSource | null): string | null {
  switch (source) {
    case "finna":
      return "Finna";
    case "google_books":
      return "Google Books";
    case "open_library":
      return "Open Library";
    case "ai":
      return "AI read it · check";
    case "you":
      return "Yours";
    case "barcode":
      return "from the barcode";
    case "typed":
      return "typed in";
    default:
      return null;
  }
}

export { isCondition };
