/**
 * Location types, limits and pure tree rules. No database access, so this is
 * safe to import from Client Components; lib/locations.ts holds the queries.
 */

export type LocationKind = "site" | "shelf" | "node";

export type Location = {
  id: string;
  parentId: string | null;
  kind: LocationKind;
  label: string;
  address: string | null;
  sortOrder: number;
};

export type LocationWithCounts = Location & {
  childCount: number;
  copyCount: number;
};

/** A shelf or section holding an address, with the site it sits under (if any). */
export type AddressedPlace = {
  id: string;
  kind: LocationKind;
  label: string;
  address: string;
  siteLabel: string | null;
};

/** A place somewhere else that already holds the address being saved. */
export type AddressHolder = AddressedPlace;

/**
 * Shelves must have an address (§4). Sections may, if they're a spot you'd
 * walk to — a table, a corner (docs/spec-corrections.md §9). Sites never do.
 */
export function canHaveAddress(kind: LocationKind): boolean {
  return kind !== "site";
}

export function requiresAddress(kind: LocationKind): boolean {
  return kind === "shelf";
}

/**
 * The address that answers "where is this?" for the last place in `path`:
 * its own, or else the nearest one above it. A book logged in "Row 2" inside
 * shelf "Bulevard 1" is found at Bulevard 1.
 */
export function nearestAddressed(path: Location[]): Location | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].address) return path[i];
  }
  return null;
}

/** Finnish-aware, number-aware: "Section 2" before "Section 10", Ä after Z. */
export const collator = new Intl.Collator("fi", { numeric: true, sensitivity: "base" });

const KIND_ORDER: Record<LocationKind, number> = { site: 0, shelf: 1, node: 1 };

/**
 * Explicit sort_order first, then sites before everything else, then label in
 * natural order — "Section 2" before "Section 10".
 */
export function byDisplayOrder(a: Location, b: Location): number {
  return (
    a.sortOrder - b.sortOrder ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    collator.compare(a.label, b.label)
  );
}

export const LABEL_MAX = 80;
export const ADDRESS_MAX = 60;

/** The site a location sits under, or null for a standalone branch. */
export function siteOf(path: Location[]): Location | null {
  return path[0]?.kind === "site" ? path[0] : null;
}

/**
 * Which kinds may be created under `parent`. Sites are always roots (§2.1).
 * Shelves don't nest inside shelves: a shelf's instructions panel covers its
 * whole subtree (§3), which stops meaning anything if a shelf holds another.
 */
export function allowedChildKinds(path: Location[]): LocationKind[] {
  if (path.length === 0) return ["site", "shelf", "node"];
  if (path.some((l) => l.kind === "shelf")) return ["node"];
  return ["shelf", "node"];
}

/**
 * Why `item` can't be moved under the location at the end of `targetPath`
 * (the roots when `targetPath` is empty), or null if it can. The same rules as
 * adding something new at that spot, plus the tree can't loop back on itself.
 *
 * `itemHasShelfBelow`: whether any shelf sits somewhere inside `item`.
 */
export function whyCannotPlace(
  item: Pick<Location, "id" | "kind">,
  itemHasShelfBelow: boolean,
  targetPath: Location[],
): string | null {
  if (item.kind === "site") return "Sites always sit at the top level.";
  if (targetPath.some((l) => l.id === item.id)) {
    return "It can't go inside itself.";
  }
  if (targetPath.some((l) => l.kind === "shelf")) {
    if (item.kind === "shelf") return "A shelf can't go inside another shelf.";
    if (itemHasShelfBelow) return "It contains a shelf, and shelves can't go inside shelves.";
  }
  return null;
}

/** Root-to-`id` path through an in-memory list of locations. */
export function pathIn(locations: Location[], id: string): Location[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: Location[] = [];
  for (let at = byId.get(id); at; at = at.parentId ? byId.get(at.parentId) : undefined) {
    path.unshift(at);
    if (path.length > locations.length) break; // defensive: never loop on bad data
  }
  return path;
}

/**
 * Places that get an instructions panel (§3, spec-corrections §14): every
 * shelf, and any section with its own address — anywhere a person can be
 * sent to by address.
 */
export function canHavePanel(location: Pick<Location, "kind" | "address">): boolean {
  return location.kind === "shelf" || (location.kind === "node" && Boolean(location.address));
}

/** The nearest place at or above the end of `path` that can have a panel. */
export function panelOwner(path: Location[]): Location | null {
  for (let i = path.length - 1; i >= 0; i--) if (canHavePanel(path[i])) return path[i];
  return null;
}
