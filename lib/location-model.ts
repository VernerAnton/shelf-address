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

/** A shelf holding an address, with the site it sits under (if any). */
export type AddressedShelf = {
  id: string;
  label: string;
  address: string;
  siteLabel: string | null;
};

/** A shelf somewhere else that already holds the address being saved. */
export type AddressHolder = AddressedShelf;

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
