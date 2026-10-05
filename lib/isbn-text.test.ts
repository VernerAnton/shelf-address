import { describe, expect, it } from "vitest";
import { findIsbns } from "@/lib/isbn-text";

describe("finding ISBNs in a copyright page", () => {
  it("a Finnish copyright page with one ISBN", () => {
    const page = `Suomentanut Kari Koski\n© Ilkka Remes 1997\nWSOY:n graafiset laitokset\nPorvoo 1997\nISBN 951-0-23076-6`;
    expect(findIsbns(page)).toEqual([{ isbn13: "9789510230763", label: "" }]);
  });

  it("ISBN-13 with hyphens, spaces or none", () => {
    for (const isbn of ["978-951-0-23076-3", "978 951 0 23076 3", "9789510230763", "ISBN: 978–951–0–23076–3"]) {
      expect(findIsbns(isbn).map((f) => f.isbn13)).toEqual(["9789510230763"]);
    }
  });

  it("several ISBNs, each with its label", () => {
    const page = `ISBN 978-951-0-23076-3 (sid.)\nISBN 978-0-00-715632-0 (nid.)\nISBN 978-951-0-36686-8 (PDF)`;
    expect(findIsbns(page)).toEqual([
      { isbn13: "9789510230763", label: "(sid.)" },
      { isbn13: "9780007156320", label: "(nid.)" },
      { isbn13: "9789510366868", label: "(PDF)" },
    ]);
  });

  it("fixes look-alike letters inside the number (O for 0, l for 1)", () => {
    expect(findIsbns("ISBN 978-95l-O-23O76-3").map((f) => f.isbn13)).toEqual(["9789510230763"]);
  });

  it("drops a misread number that fails the check digit", () => {
    expect(findIsbns("ISBN 978-951-0-23076-4")).toEqual([]);
  });

  it("ignores other numbers on the page (years, phone numbers, printing runs)", () => {
    expect(findIsbns("Painettu 1997\nPuh. 09 6168 1\n1. painos 1997\n12345 67890")).toEqual([]);
  });

  it("ISBN-10 ending in X", () => {
    expect(findIsbns("ISBN 0-8044-2957-X").map((f) => f.isbn13)).toEqual(["9780804429573"]);
  });
});
