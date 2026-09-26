import { describe, expect, it } from "vitest";
import {
  allowedChildKinds,
  canHaveAddress,
  canHavePanel,
  panelOwner,
  nearestAddressed,
  requiresAddress,
  whyCannotPlace,
  type Location,
} from "@/lib/location-model";

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

describe("nearestAddressed", () => {
  const addressed = (l: Location, address: string): Location => ({ ...l, address });

  it("uses the place's own address when it has one", () => {
    const corner = addressed(loc("corner", "node", "store"), "Torikatu 3");
    expect(nearestAddressed([store, corner])?.id).toBe("corner");
  });

  it("falls back to the nearest addressed place above", () => {
    const wall = addressed(shelf, "Bulevard 1");
    expect(nearestAddressed([store, room, wall, row])?.id).toBe("shelf");
  });

  it("prefers the closest of several addressed ancestors", () => {
    const hall = addressed(room, "Bulevard");
    const wall = addressed(shelf, "Bulevard 1");
    expect(nearestAddressed([store, hall, wall, row])?.id).toBe("shelf");
  });

  it("is null when nothing on the way up has an address", () => {
    expect(nearestAddressed([store, room])).toBeNull();
  });
});

describe("addresses by kind", () => {
  it("requires one on shelves, allows one on sections, never on sites", () => {
    expect([requiresAddress("shelf"), canHaveAddress("shelf")]).toEqual([true, true]);
    expect([requiresAddress("node"), canHaveAddress("node")]).toEqual([false, true]);
    expect([requiresAddress("site"), canHaveAddress("site")]).toEqual([false, false]);
  });
});

describe("instruction panels", () => {
  const addressed = (l: Location, address: string): Location => ({ ...l, address });

  it("go on shelves and addressed sections only", () => {
    expect(canHavePanel(shelf)).toBe(true);
    expect(canHavePanel(addressed(room, "Torikatu 3"))).toBe(true);
    expect(canHavePanel(room)).toBe(false);
    expect(canHavePanel(store)).toBe(false);
  });

  it("the governing panel is the nearest eligible place at or above", () => {
    expect(panelOwner([store, room, shelf, row])?.id).toBe("shelf");
    expect(panelOwner([store, room, shelf])?.id).toBe("shelf");
    expect(panelOwner([store, addressed(room, "Torikatu 3"), shelf, row])?.id).toBe("shelf");
    expect(panelOwner([store, room])).toBeNull();
  });
});
