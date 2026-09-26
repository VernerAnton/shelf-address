import { describe, expect, it } from "vitest";
import { editionSearchText, foldForSearch, searchWords } from "@/lib/search";

describe("search folding", () => {
  it("folds Finnish letters and punctuation", () => {
    expect(foldForSearch("PÄÄKALLOKEHRÄÄJÄ")).toBe("pääkallokehrääjä");
    expect(foldForSearch("Fantastic Mr. Fox")).toBe("fantastic mr fox");
  });
  it("never lets LIKE wildcards through", () => {
    expect(searchWords("100% _true_")).toEqual(["100", "true"]);
  });
  it("indexes title, author, publisher and the ISBN", () => {
    expect(editionSearchText({ key: "9789510230763", title: "Pääkallokehrääjä", author: "Ilkka Remes", publisher: "WSOY" }))
      .toBe("pääkallokehrääjä ilkka remes wsoy 9789510230763");
    expect(editionSearchText({ key: "manual:x", title: "Vanha kirja", author: null })).toBe("vanha kirja");
  });
});
