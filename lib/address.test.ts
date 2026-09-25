import { describe, expect, it } from "vitest";
import { addressKey, cleanAddress, displayAddress, isSimilarAddress } from "@/lib/address";

describe("cleanAddress", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanAddress("  Bulevard   1 ")).toBe("Bulevard 1");
  });

  it("normalises decomposed characters to their composed form", () => {
    const decomposed = "Äkko"; // A + combining diaeresis
    expect(cleanAddress(decomposed)).toBe("Äkko");
  });
});

describe("addressKey", () => {
  it("folds ASCII case", () => {
    expect(addressKey("BULEVARD 1")).toBe(addressKey("bulevard 1"));
  });

  it("folds Finnish letters, which SQLite NOCASE does not", () => {
    expect(addressKey("ÄÄKKÖNEN 2")).toBe(addressKey("ääkkönen 2"));
    expect(addressKey("Åland 3")).toBe(addressKey("åland 3"));
  });

  it("treats a decomposed and a composed Ä as the same address", () => {
    expect(addressKey("Äkko")).toBe(addressKey("Äkko"));
  });

  it("ignores stray whitespace", () => {
    expect(addressKey(" Bulevard  1")).toBe(addressKey("Bulevard 1"));
  });

  it("keeps genuinely different addresses different", () => {
    expect(addressKey("Bulevard 1")).not.toBe(addressKey("Bulevard 10"));
  });
});

describe("isSimilarAddress", () => {
  const similar = (a: string, b: string) =>
    isSimilarAddress(addressKey(a), addressKey(b));

  it("flags a site-prefixed variant of an existing address", () => {
    expect(similar("Warehouse A Bulevard 1", "Bulevard 1")).toBe(true);
    expect(similar("Bulevard 1", "Warehouse A Bulevard 1")).toBe(true);
  });

  it("flags punctuation-only differences", () => {
    expect(similar("Bulevard-1", "Bulevard 1")).toBe(true);
    expect(similar("Bulevard, 1", "Bulevard 1")).toBe(true);
  });

  it("does not flag a different number on the same street", () => {
    expect(similar("Bulevard 10", "Bulevard 1")).toBe(false);
    expect(similar("Bulevard 1", "Bulevard 11")).toBe(false);
  });

  it("does not flag a partial word", () => {
    expect(similar("Bulevardi 1", "Bulevard 1")).toBe(false);
  });

  it("does not flag the words appearing out of order", () => {
    expect(similar("1 Bulevard", "Bulevard 1")).toBe(false);
  });

  it("leaves exact duplicates to the hard uniqueness check", () => {
    expect(similar("Bulevard 1", "bulevard 1")).toBe(false);
  });
});

describe("displayAddress", () => {
  it("prefixes the site taken from the tree", () => {
    expect(displayAddress("Bulevard 1", "Warehouse A")).toBe("Warehouse A — Bulevard 1");
  });

  it("shows a standalone shelf's address bare", () => {
    expect(displayAddress("Kauppatori 4", null)).toBe("Kauppatori 4");
  });
});
