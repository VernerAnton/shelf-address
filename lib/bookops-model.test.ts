import { describe, expect, it } from "vitest";
import { formatPrice, mayFill, missingForListing, parsePrice, queueState, type BookOpsBook } from "@/lib/bookops-model";

const book = (over: Partial<BookOpsBook> = {}): BookOpsBook => ({
  id: "b1",
  createdAt: "2026-11-16T10:00:00.000Z",
  updatedAt: "2026-11-16T10:00:00.000Z",
  status: "draft",
  isbn13: null,
  isbnSource: null,
  title: null,
  titleSource: null,
  author: null,
  authorSource: null,
  publisher: null,
  publisherSource: null,
  year: null,
  yearSource: null,
  description: null,
  descriptionSource: null,
  priceCents: null,
  condition: null,
  quantity: 1,
  location: null,
  frontPhoto: null,
  backPhoto: null,
  lookupStatus: "none",
  aiStatus: "none",
  aiNote: null,
  listedAt: null,
  listingRef: null,
  ...over,
});

describe("which source may fill a field", () => {
  it("an empty field takes anything", () => {
    expect(mayFill(null, "ai")).toBe(true);
    expect(mayFill(null, "finna")).toBe(true);
  });
  it("what the person typed is never overwritten", () => {
    expect(mayFill("you", "finna")).toBe(false);
    expect(mayFill("you", "ai")).toBe(false);
  });
  it("the AI's reading gives way to a database, not the other way round", () => {
    expect(mayFill("ai", "finna")).toBe(true);
    expect(mayFill("ai", "open_library")).toBe(true);
    expect(mayFill("finna", "ai")).toBe(false);
    expect(mayFill("ai", "ai")).toBe(false);
  });
  it("a database's answer stays", () => {
    expect(mayFill("finna", "google_books")).toBe(false);
  });
});

describe("prices", () => {
  it("Finnish and English decimals, with or without €", () => {
    expect(parsePrice("14")).toBe(1400);
    expect(parsePrice("14,5")).toBe(1450);
    expect(parsePrice("14,50")).toBe(1450);
    expect(parsePrice("14.50 €")).toBe(1450);
    expect(parsePrice("€ 6,05")).toBe(605);
    expect(parsePrice("0,50")).toBe(50);
    expect(parsePrice("14,")).toBe(1400);
  });
  it("empty means no price yet", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("  ")).toBeNull();
  });
  it("anything else is refused", () => {
    for (const bad of ["abc", "14,505", "-3", "1 2,3x", "12e3", ",50"]) expect(parsePrice(bad)).toBe("bad");
  });
  it("written back the Finnish way", () => {
    expect(formatPrice(1450)).toBe("14,50");
    expect(formatPrice(605)).toBe("6,05");
    expect(formatPrice(50)).toBe("0,50");
    expect(formatPrice(1400)).toBe("14,00");
  });
});

describe("the queue's label", () => {
  it("reading while a lookup or the AI is still going", () => {
    expect(queueState(book({ aiStatus: "pending" }))).toBe("reading");
    expect(queueState(book({ lookupStatus: "pending", title: "X", priceCents: 100, condition: "K3" }))).toBe("reading");
  });
  it("to price until it has a title, a price and a condition", () => {
    expect(queueState(book({ title: "Sinuhe" }))).toBe("price");
    expect(missingForListing(book({ title: "Sinuhe" }))).toEqual(["a price", "a condition"]);
    expect(missingForListing(book({ title: "  ", priceCents: 0, condition: "K5" }))).toEqual(["a title"]);
  });
  it("ready, then listed", () => {
    const ready = book({ title: "Sinuhe", priceCents: 1400, condition: "K4" });
    expect(queueState(ready)).toBe("ready");
    expect(queueState({ ...ready, status: "listed" })).toBe("listed");
  });
});
