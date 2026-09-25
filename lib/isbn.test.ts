import { describe, expect, it } from "vitest";
import { formatIsbn, isIsbn13, isbn10to13, parseIsbn } from "@/lib/isbn";

describe("isIsbn13", () => {
  it("accepts real ISBNs with 978 and 979 prefixes", () => {
    expect(isIsbn13("9789510366868")).toBe(true); // Waltari, Sinuhe egyptiläinen
    expect(isIsbn13("9780306406157")).toBe(true);
    expect(isIsbn13("9791032305690")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isIsbn13("9789510366869")).toBe(false);
  });

  it("rejects non-book EAN-13s, which scan fine but aren't ISBNs", () => {
    expect(isIsbn13("6415712502504")).toBe(false); // a grocery barcode shape
    expect(isIsbn13("2000000000008")).toBe(false); // in-store price label range
  });
});

describe("isbn10to13", () => {
  it("converts, recomputing the check digit", () => {
    expect(isbn10to13("0306406152")).toBe("9780306406157");
    expect(isbn10to13("080442957X")).toBe("9780804429573");
  });
});

describe("parseIsbn", () => {
  it("takes a plain ISBN-13", () => {
    expect(parseIsbn("9789510366868")).toEqual({ ok: true, isbn13: "9789510366868", convertedFrom10: false });
  });

  it("ignores hyphens and spaces", () => {
    expect(parseIsbn("978-951-03-6686-8")).toMatchObject({ ok: true, isbn13: "9789510366868" });
    expect(parseIsbn(" 978 951 0366868 ")).toMatchObject({ ok: true, isbn13: "9789510366868" });
  });

  it("converts an ISBN-10, including one ending in X", () => {
    expect(parseIsbn("0-306-40615-2")).toEqual({ ok: true, isbn13: "9780306406157", convertedFrom10: true });
    expect(parseIsbn("080442957x")).toEqual({ ok: true, isbn13: "9780804429573", convertedFrom10: true });
  });

  it("explains what's wrong instead of just refusing", () => {
    expect(parseIsbn("")).toMatchObject({ ok: false, reason: expect.stringMatching(/Enter/) });
    expect(parseIsbn("12345")).toMatchObject({ ok: false, reason: expect.stringMatching(/10 or 13 digits/) });
    expect(parseIsbn("2000000000008")).toMatchObject({ ok: false, reason: expect.stringMatching(/not a book barcode/) });
    expect(parseIsbn("9789510366869")).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't check out/) });
    expect(parseIsbn("0306406153")).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't check out/) });
  });
});

describe("formatIsbn", () => {
  it("groups prefix, body and check digit", () => {
    expect(formatIsbn("9789510366868")).toBe("978-951036686-8");
  });
});
