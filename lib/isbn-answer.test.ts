import { describe, expect, it } from "vitest";
import { isbnsInAnswer } from "./isbn";

describe("isbnsInAnswer (V34.5)", () => {
  it("reads one ISBN", () => {
    expect(isbnsInAnswer("9789510230763")).toEqual(["9789510230763"]);
  });
  it("reads two different ISBNs, one per line, in order", () => {
    expect(isbnsInAnswer("9789510230763\n978-952-93-6253-0")).toEqual(["9789510230763", "9789529362530"]);
  });
  it("counts the 10- and 13-digit forms of one ISBN once", () => {
    expect(isbnsInAnswer("951-0-23076-6\n9789510230763")).toEqual(["9789510230763"]);
  });
  it("skips digits that don't check out, keeps the valid one", () => {
    expect(isbnsInAnswer("9789510230764\n9789529362530")).toEqual(["9789529362530"]);
  });
  it("takes ISBN labels and commas in its stride", () => {
    expect(isbnsInAnswer("ISBN 978-951-0-23076-3, ISBN 978-952-93-6253-0")).toEqual(["9789510230763", "9789529362530"]);
  });
  it("NONE, or nothing usable: none", () => {
    expect(isbnsInAnswer("NONE")).toEqual([]);
    expect(isbnsInAnswer("I can't see an ISBN.")).toEqual([]);
  });
  it("at most two", () => {
    expect(isbnsInAnswer("9789510230763\n9789529362530\n9789510366868")).toHaveLength(2);
  });
});
