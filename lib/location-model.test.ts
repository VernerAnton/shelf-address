import { describe, expect, it } from "vitest";
import { allowedChildKinds, whyCannotPlace, type Location } from "@/lib/location-model";

const loc = (id: string, kind: Location["kind"], parentId: string | null = null): Location => ({
  id,
  parentId,
  kind,
  label: id,
  address: null,
  sortOrder: 0,
});

const store = loc("store", "site");
const room = loc("room", "node", "store");
const shelf = loc("shelf", "shelf", "room");
const row = loc("row", "node", "shelf");

describe("allowedChildKinds", () => {
  it("allows anything at the top level", () => {
    expect(allowedChildKinds([])).toEqual(["site", "shelf", "node"]);
  });
  it("never allows a site below the top level", () => {
    expect(allowedChildKinds([store])).toEqual(["shelf", "node"]);
  });
  it("allows only sections anywhere inside a shelf", () => {
    expect(allowedChildKinds([store, room, shelf])).toEqual(["node"]);
    expect(allowedChildKinds([store, room, shelf, row])).toEqual(["node"]);
  });
});

describe("whyCannotPlace", () => {
  it("lets a section move to another site", () => {
    expect(whyCannotPlace(room, false, [loc("wh", "site")])).toBeNull();
  });

  it("lets a shelf or section become standalone at the top level", () => {
    expect(whyCannotPlace(shelf, false, [])).toBeNull();
    expect(whyCannotPlace(room, true, [])).toBeNull();
  });

  it("never moves a site", () => {
    expect(whyCannotPlace(store, false, [])).not.toBeNull();
  });

  it("refuses to put something inside itself or its own contents", () => {
    expect(whyCannotPlace(room, true, [store, room])).not.toBeNull();
    expect(whyCannotPlace(room, true, [store, room, shelf, row])).not.toBeNull();
  });

  it("refuses a shelf inside a shelf, at any depth", () => {
    const other = loc("other", "shelf", "store");
    expect(whyCannotPlace(other, false, [store, room, shelf])).not.toBeNull();
    expect(whyCannotPlace(other, false, [store, room, shelf, row])).not.toBeNull();
  });

  it("refuses a section holding a shelf inside a shelf", () => {
    const box = loc("box", "node", "store");
    expect(whyCannotPlace(box, true, [store, room, shelf])).not.toBeNull();
    expect(whyCannotPlace(box, false, [store, room, shelf])).toBeNull();
  });
});
