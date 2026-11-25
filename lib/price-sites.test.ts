import { describe, expect, it } from "vitest";
import { PRICE_SITES, priceQuery } from "@/lib/price-sites";

describe("BookOps price check links", () => {
  it("four sites, Antikvaari first", () => {
    expect(PRICE_SITES.map((s) => s.id)).toEqual(["antikvaari", "adlibris", "suomalainen", "akateeminen"]);
  });
  it("search by ISBN when there is one", () => {
    const query = priceQuery({ isbn13: "9789510230763", title: "Pääkallokehrääjä", author: "Ilkka Remes" });
    expect(query).toBe("9789510230763");
    expect(PRICE_SITES.map((s) => s.url(query!))).toEqual([
      "https://www.antikvaari.fi/hakukone?q=9789510230763",
      "https://www.adlibris.com/fi/haku?q=9789510230763",
      "https://www.suomalainen.com/search?q=9789510230763",
      "https://www.akateeminen.com/search?q=9789510230763",
    ]);
  });
  it("by title and author for a book without an ISBN, safely encoded", () => {
    const query = priceQuery({ isbn13: null, title: " Kotimaan linnut ", author: "Lehtonen & Väisänen" });
    expect(query).toBe("Kotimaan linnut Lehtonen & Väisänen");
    expect(PRICE_SITES[1].url(query!)).toBe("https://www.adlibris.com/fi/haku?q=Kotimaan%20linnut%20Lehtonen%20%26%20V%C3%A4is%C3%A4nen");
  });
  it("nothing to search for yet", () => {
    expect(priceQuery({ isbn13: null, title: null, author: " " })).toBeNull();
  });
});
