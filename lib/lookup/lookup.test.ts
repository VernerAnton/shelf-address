import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, lookupFinnaRecord, lookupIsbn, type GetJson } from "./chain";
import { parseFinnaEditionSearch, parseFinnaIsbnSearch, recordIsbns } from "./finna";
import { parseGoogleBooks } from "./google";
import { cleanTitle, displayName, joinNames, parseYear } from "./names";
import { parseOpenLibraryAuthor, parseOpenLibraryEdition } from "./openlibrary";

// Real responses recorded from the live APIs (Sept 2026), except where named
// ".synthetic" — see that file's _note.
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"));
const COVERS = DEFAULT_CONFIG.finnaCoverBase;

describe("names", () => {
  it("turns catalogue names into display names", () => {
    expect(displayName("Remes, Ilkka")).toBe("Ilkka Remes");
    expect(displayName("Waltari, Mika, 1908-1979.")).toBe("Mika Waltari");
    expect(displayName("Bovil")).toBe("Bovil");
    expect(displayName("Roald Dahl")).toBe("Roald Dahl");
  });
  it("joins distinct names, at most three", () => {
    expect(joinNames(["Waltari, Mika", "Mika Waltari", "Parkkinen, Jukka"])).toBe("Mika Waltari, Jukka Parkkinen");
    expect(joinNames([])).toBeNull();
  });
  it("finds a year in various date styles", () => {
    expect(parseYear("1997")).toBe(1997);
    expect(parseYear("October 1, 1988")).toBe(1988);
    expect(parseYear("[1946]")).toBe(1946);
    expect(parseYear(undefined)).toBeNull();
  });
  it("strips catalogue punctuation from titles", () => {
    expect(cleanTitle('"Sinuhe egyptiläinen"')).toBe("Sinuhe egyptiläinen");
    expect(cleanTitle("Pääkallokehrääjä /")).toBe("Pääkallokehrääjä");
  });
});

describe("Finna ISBN search", () => {
  const json = fixture("finna-isbn-9789510230763.json");

  it("reads ISBNs in every catalogue style, converting ISBN-10", () => {
    expect(recordIsbns({ isbns: ["951-0-23076-6 pehmeäkantinen"] })).toEqual(["9789510230763"]);
    expect(recordIsbns({ isbns: ["978-951-0-22133-4"] })).toEqual(["9789510221334"]);
  });

  it("ignores other books the fuzzy search returns, and outvotes a miscatalogued record", () => {
    // The response includes records for a different ISBN, and one library's
    // record for "Karjalan lunnaat" wrongly listing this ISBN.
    const data = parseFinnaIsbnSearch(json, "9789510230763", COVERS);
    expect(data).toMatchObject({ title: "Pääkallokehrääjä", author: "Ilkka Remes", publisher: "WSOY", source: "finna" });
    expect([1997, 1998]).toContain(data?.year);
  });

  it("returns null when no record carries the ISBN", () => {
    expect(parseFinnaIsbnSearch(json, "9780000000002", COVERS)).toBeNull();
  });

  it("reads an English book Finna holds", () => {
    const data = parseFinnaIsbnSearch(fixture("finna-isbn-9780007156320.json"), "9780007156320", COVERS);
    // The record lists the translator with no role; only the main author is shown.
    expect(data).toMatchObject({ title: "Manual of the warrior of light", author: "Paulo Coelho", year: 2003 });
  });
});

describe("Finna title search (books without a barcode)", () => {
  const choices = parseFinnaEditionSearch(fixture("finna-search-sinuhe.json"), COVERS);

  it("offers one entry per distinct edition, not one per library", () => {
    const keys = choices.map((c) => c.isbn13 ?? `${c.title}|${c.year}|${c.publisher}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(choices.length).toBeGreaterThan(3);
  });

  it("carries enough to tell editions apart", () => {
    expect(choices.every((c) => c.finnaId && c.title)).toBe(true);
    expect(choices.some((c) => c.year === 1946)).toBe(true);
  });

  it("builds absolute cover URLs from Finna's relative paths", () => {
    const withCover = choices.find((c) => c.coverUrl);
    if (withCover) expect(withCover.coverUrl).toMatch(/^https:\/\/api\.finna\.fi\/Cover\/Show\?/);
  });
});

describe("Google Books", () => {
  it("uses only the volume that lists our ISBN, with an https cover", () => {
    const data = parseGoogleBooks(fixture("google-9780007156320.synthetic.json"), "9780007156320");
    expect(data).toMatchObject({ title: "Manual of the Warrior of Light", author: "Paulo Coelho", year: 2003 });
    expect(data?.coverUrl).toMatch(/^https:/);
    expect(data?.coverUrl).not.toMatch(/edge=curl/);
  });
});

describe("Open Library", () => {
  it("reads an edition and its author", () => {
    const edition = parseOpenLibraryEdition(fixture("openlibrary-isbn-9780140328721.json"));
    expect(edition).toMatchObject({ title: "Fantastic Mr. Fox", publisher: "Puffin", year: 1988 });
    expect(edition?.authorKeys).toEqual(["/authors/OL34184A"]);
    expect(edition?.coverId).toBeGreaterThan(0);
    expect(parseOpenLibraryAuthor(fixture("openlibrary-author-OL34184A.json"))).toBe("Roald Dahl");
  });
});

describe("lookup chain", () => {
  const routes = (map: Record<string, { status: number; json?: unknown } | "down">): GetJson =>
    async (url) => {
      const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
      if (!hit || hit[1] === "down") throw new TypeError("network down");
      return { status: hit[1].status, json: hit[1].json ?? null };
    };
  const FINNA = "https://api.finna.fi/v1/search";
  const GOOGLE = "https://www.googleapis.com";
  const OL = "https://openlibrary.org/isbn/";
  const OL_AUTHOR = "https://openlibrary.org/authors/";

  it("takes Finna's details, and a cover from a later source when Finna has none", async () => {
    const result = await lookupIsbn(
      "9780007156320",
      routes({
        [FINNA]: { status: 200, json: fixture("finna-isbn-9780007156320.json") },
        [GOOGLE]: { status: 200, json: fixture("google-9780007156320.synthetic.json") },
      }),
    );
    expect(result.outcome).toBe("found");
    if (result.outcome !== "found") return;
    expect(result.data.source).toBe("finna");
    expect(result.data.coverUrl).toMatch(/books\.google\.com/);
  });

  it("falls through to Open Library when the others don't know the book", async () => {
    const result = await lookupIsbn(
      "9780140328721",
      routes({
        [FINNA]: { status: 200, json: { records: [] } },
        [GOOGLE]: { status: 429 },
        [OL]: { status: 200, json: fixture("openlibrary-isbn-9780140328721.json") },
        [OL_AUTHOR]: { status: 200, json: fixture("openlibrary-author-OL34184A.json") },
      }),
    );
    expect(result).toMatchObject({ outcome: "found", data: { title: "Fantastic Mr. Fox", author: "Roald Dahl", source: "open_library" } });
  });

  it("says not found only when every source actually answered", async () => {
    const result = await lookupIsbn(
      "9780000000002",
      routes({ [FINNA]: { status: 200, json: { records: [] } }, [GOOGLE]: { status: 200, json: {} }, [OL]: { status: 404 } }),
    );
    expect(result.outcome).toBe("not_found");
  });

  it("asks to retry when a source was unreachable and nothing was found", async () => {
    const result = await lookupIsbn(
      "9780000000002",
      routes({ [FINNA]: "down", [GOOGLE]: { status: 429 }, [OL]: { status: 404 } }),
    );
    expect(result.outcome).toBe("retry");
  });

  it("still finds a book when the first source is down", async () => {
    const result = await lookupIsbn(
      "9780140328721",
      routes({ [FINNA]: "down", [GOOGLE]: { status: 503 }, [OL]: { status: 200, json: fixture("openlibrary-isbn-9780140328721.json") }, [OL_AUTHOR]: "down" }),
    );
    expect(result).toMatchObject({ outcome: "found", data: { title: "Fantastic Mr. Fox", author: null } });
  });

  it("looks up a barcode-less edition by its Finna record", async () => {
    const result = await lookupFinnaRecord(
      "keski.334708",
      routes({ "https://api.finna.fi/v1/record": { status: 200, json: fixture("finna-record-keski.334708.json") } }),
    );
    expect(result).toMatchObject({ outcome: "found", data: { title: "Sinuhe egyptiläinen", year: 1946 } });
  });
});
