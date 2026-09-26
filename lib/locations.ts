import { getBucket, getDb } from "@/lib/cloudflare";
import { addressKey, cleanAddress, isSimilarAddress } from "@/lib/address";
import {
  allowedChildKinds,
  byDisplayOrder,
  canHaveAddress,
  collator,
  whyCannotPlace,
  type AddressHolder,
  type AddressedPlace,
  type Location,
  type LocationKind,
  type LocationWithCounts,
} from "@/lib/location-model";

export * from "@/lib/location-model";

/**
 * Location tree data access. Spec §2.1, §4, and docs/spec-corrections.md.
 *
 * The database enforces the structural rules (a site is always a root,
 * addresses are shelf-only and unique, ...). This module adds the rules that
 * need knowledge of the rest of the tree, and turns constraint failures into
 * answers a person can act on.
 */


type LocationRow = {
  id: string;
  parent_id: string | null;
  kind: LocationKind;
  label: string;
  address: string | null;
  sort_order: number;
};

const COLUMNS = "id, parent_id, kind, label, address, sort_order";

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    label: row.label,
    address: row.address,
    sortOrder: row.sort_order,
  };
}


// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getLocation(id: string): Promise<Location | null> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM locations WHERE id = ?`)
    .bind(id)
    .first<LocationRow>();
  return row ? toLocation(row) : null;
}

/** The path from the root down to and including `id`. Empty if not found. */
export async function getPath(id: string): Promise<Location[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `WITH RECURSIVE path(id, depth) AS (
         SELECT id, 0 FROM locations WHERE id = ?
         UNION ALL
         SELECT l.parent_id, path.depth + 1
         FROM path JOIN locations l ON l.id = path.id
         WHERE l.parent_id IS NOT NULL
       )
       SELECT ${COLUMNS.split(", ").map((c) => `l.${c}`).join(", ")}
       FROM path JOIN locations l ON l.id = path.id
       ORDER BY path.depth DESC`,
    )
    .bind(id)
    .all<LocationRow>();
  return results.map(toLocation);
}

/** Direct children of `parentId`, or the roots when `parentId` is null. */
export async function listChildren(
  parentId: string | null,
): Promise<LocationWithCounts[]> {
  const db = await getDb();
  const where = parentId === null ? "l.parent_id IS NULL" : "l.parent_id = ?";
  const statement = db.prepare(
    `SELECT ${COLUMNS.split(", ").map((c) => `l.${c}`).join(", ")},
       (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id) AS child_count,
       (SELECT COUNT(*) FROM copies p WHERE p.location_id = l.id) AS copy_count
     FROM locations l
     WHERE ${where}`,
  );
  const { results } = await (parentId === null
    ? statement
    : statement.bind(parentId)
  ).all<LocationRow & { child_count: number; copy_count: number }>();

  return results
    .map((row) => ({
      ...toLocation(row),
      childCount: row.child_count,
      copyCount: row.copy_count,
    }))
    .sort(byDisplayOrder);
}

/** The whole tree in one query — small by nature (one row per place). */
export async function listAllLocations(): Promise<Location[]> {
  const db = await getDb();
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM locations`).all<LocationRow>();
  return results.map(toLocation);
}

/** Every shelf and section that has an address, A–Z by address. */
export async function listAddressedPlaces(): Promise<AddressedPlace[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `WITH RECURSIVE up(shelf_id, cur_id, cur_parent) AS (
         SELECT id, id, parent_id FROM locations WHERE address IS NOT NULL
         UNION ALL
         SELECT up.shelf_id, l.id, l.parent_id
         FROM up JOIN locations l ON l.id = up.cur_parent
       )
       SELECT s.id, s.kind, s.label, s.address,
              CASE WHEN r.kind = 'site' THEN r.label END AS site_label
       FROM up
       JOIN locations s ON s.id = up.shelf_id
       JOIN locations r ON r.id = up.cur_id
       WHERE up.cur_parent IS NULL`,
    )
    .all<{
      id: string;
      kind: LocationKind;
      label: string;
      address: string;
      site_label: string | null;
    }>();

  return results
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      address: row.address,
      siteLabel: row.site_label,
    }))
    .sort((a, b) => collator.compare(a.address, b.address));
}

/** True if any location in the subtree strictly below `id` is a shelf. */
export async function hasShelfBelow(id: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .prepare(
      `WITH RECURSIVE below(id) AS (
         SELECT id FROM locations WHERE parent_id = ?
         UNION ALL
         SELECT l.id FROM locations l JOIN below ON l.parent_id = below.id
       )
       SELECT 1 AS found FROM below JOIN locations l ON l.id = below.id
       WHERE l.kind = 'shelf' LIMIT 1`,
    )
    .bind(id)
    .first<{ found: number }>();
  return row !== null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AddressCheck =
  | { status: "free" }
  | { status: "taken"; holder: AddressHolder }
  | { status: "similar"; matches: AddressHolder[] };

/**
 * §4 save-time check. `taken` means another shelf or section holds exactly
 * this address (hard stop unless the person confirms moving it); `similar`
 * means it looks like an existing address written differently (soft warning).
 */
export async function checkAddress(
  address: string,
  excludeId: string | null,
): Promise<AddressCheck> {
  const key = addressKey(address);
  const others = (await listAddressedPlaces()).filter((s) => s.id !== excludeId);

  const exact = others.find((s) => addressKey(s.address) === key);
  if (exact) return { status: "taken", holder: exact };

  const matches = others.filter((s) => isSimilarAddress(key, addressKey(s.address)));
  if (matches.length > 0) return { status: "similar", matches };

  return { status: "free" };
}

export class LocationError extends Error {}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type LocationInput = {
  label: string;
  kind: LocationKind;
  address: string | null;
};

/**
 * Statements that release `address` from whichever shelf currently holds it.
 * Run in the same batch as the write that claims it, so the address is never
 * on two shelves and never lost if the write fails. docs/spec-corrections.md §2.
 */
function releaseAddress(db: D1Database, address: string, keepId: string | null) {
  return db
    .prepare(
      `UPDATE locations SET address = NULL, address_key = NULL
       WHERE address_key = ? AND id IS NOT ?`,
    )
    .bind(addressKey(address), keepId);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * Where a newcomer to `parentId`'s children goes. Until someone reorders a
 * level, every entry there has sort_order 0 and the list shows in natural
 * label order. Once reordered, entries are numbered 1..n and a newcomer goes
 * last.
 */
async function nextSortOrder(db: D1Database, parentId: string | null): Promise<number> {
  const row = await db
    .prepare(
      parentId === null
        ? "SELECT COALESCE(MAX(sort_order), 0) AS n FROM locations WHERE parent_id IS NULL"
        : "SELECT COALESCE(MAX(sort_order), 0) AS n FROM locations WHERE parent_id = ?",
    )
    .bind(...(parentId === null ? [] : [parentId]))
    .first<{ n: number }>();
  return row?.n ? row.n + 1 : 0;
}

export async function createLocation(
  parentId: string | null,
  input: LocationInput,
  options: { takeAddress: boolean },
): Promise<string> {
  const db = await getDb();
  const path = parentId ? await getPath(parentId) : [];
  if (parentId && path.length === 0) {
    throw new LocationError("The place you were adding to no longer exists.");
  }
  if (!allowedChildKinds(path).includes(input.kind)) {
    throw new LocationError("That kind of location can't go here.");
  }

  const id = crypto.randomUUID();
  const address = canHaveAddress(input.kind) && input.address ? cleanAddress(input.address) : null;

  const sortOrder = await nextSortOrder(db, parentId);

  const insert = db
    .prepare(
      `INSERT INTO locations (id, parent_id, kind, label, address, address_key, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      parentId,
      input.kind,
      input.label,
      address,
      address ? addressKey(address) : null,
      sortOrder,
    );

  try {
    if (address && options.takeAddress) {
      await db.batch([releaseAddress(db, address, null), insert]);
    } else {
      await insert.run();
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new LocationError("That address was just taken by another shelf. Try saving again.");
    }
    throw error;
  }
  return id;
}

export async function updateLocation(
  id: string,
  input: LocationInput,
  options: { takeAddress: boolean },
): Promise<void> {
  const db = await getDb();
  const path = await getPath(id);
  const current = path.at(-1);
  if (!current) throw new LocationError("This location no longer exists.");

  if (current.kind !== input.kind) {
    if (current.kind === "site" || input.kind === "site") {
      throw new LocationError("A site can't be turned into anything else, or vice versa.");
    }
    if (input.kind === "shelf") {
      if (path.slice(0, -1).some((l) => l.kind === "shelf")) {
        throw new LocationError("This is already inside a shelf, so it can't be a shelf itself.");
      }
      if (await hasShelfBelow(id)) {
        throw new LocationError("There's a shelf further inside this one, so it can't be a shelf itself.");
      }
    }
  }

  const address = canHaveAddress(input.kind) && input.address ? cleanAddress(input.address) : null;

  // Turning a shelf into a section keeps its address but drops the
  // shelf-only instructions panel (§3).
  const update = db
    .prepare(
      `UPDATE locations
       SET kind = ?, label = ?, address = ?, address_key = ?,
           instructions = CASE WHEN ? = 'shelf' THEN instructions END
       WHERE id = ?`,
    )
    .bind(input.kind, input.label, address, address ? addressKey(address) : null, input.kind, id);

  try {
    if (address && options.takeAddress) {
      await db.batch([releaseAddress(db, address, id), update]);
    } else {
      await update.run();
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new LocationError("That address was just taken by another shelf. Try saving again.");
    }
    throw error;
  }
}

/**
 * Deletes a location. Refuses if anything is inside it or shelved at it —
 * deleting is never allowed to silently take other entries with it.
 */
export async function deleteLocation(id: string): Promise<{ parentId: string | null }> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT parent_id,
         (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id) AS child_count,
         (SELECT COUNT(*) FROM copies p WHERE p.location_id = l.id) AS copy_count
       FROM locations l WHERE id = ?`,
    )
    .bind(id)
    .first<{ parent_id: string | null; child_count: number; copy_count: number }>();

  if (!row) throw new LocationError("This location no longer exists.");
  if (row.child_count > 0) {
    throw new LocationError(
      `There ${row.child_count === 1 ? "is 1 place" : `are ${row.child_count} places`} inside this. Delete or empty those first.`,
    );
  }
  if (row.copy_count > 0) {
    throw new LocationError(
      `${row.copy_count === 1 ? "1 book is" : `${row.copy_count} books are`} logged here. Move them first.`,
    );
  }

  const deleted = await db
    .prepare("DELETE FROM locations WHERE id = ? RETURNING map_image_id")
    .bind(id)
    .first<{ map_image_id: string | null }>();
  // A site's map photo goes with it (§5).
  if (deleted?.map_image_id) await (await getBucket()).delete(deleted.map_image_id);
  return { parentId: row.parent_id };
}

/**
 * Moves `id` (and everything inside it, and every book logged there) under
 * `targetId`, or to the top level when `targetId` is null. The address, if
 * any, stays with the shelf; its displayed site follows the new position.
 */
export async function moveLocation(id: string, targetId: string | null): Promise<void> {
  const db = await getDb();
  const item = await getLocation(id);
  if (!item) throw new LocationError("This location no longer exists.");

  const targetPath = targetId ? await getPath(targetId) : [];
  if (targetId && targetPath.length === 0) {
    throw new LocationError("The place you were moving it to no longer exists.");
  }
  if (item.parentId === targetId) return;

  const reason = whyCannotPlace(item, await hasShelfBelow(id), targetPath);
  if (reason) throw new LocationError(reason);

  await db
    .prepare("UPDATE locations SET parent_id = ?, sort_order = ? WHERE id = ?")
    .bind(targetId, await nextSortOrder(db, targetId), id)
    .run();
}

/**
 * Moves `id` one place up or down among its siblings. The first time a level
 * is reordered, its current on-screen order is written out as 1..n, so the
 * swap starts from exactly what the person was looking at.
 */
export async function shiftLocation(id: string, direction: "up" | "down"): Promise<void> {
  const db = await getDb();
  const item = await getLocation(id);
  if (!item) throw new LocationError("This location no longer exists.");

  const siblings = await listChildren(item.parentId);
  const index = siblings.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return;

  const order = siblings.map((s) => s.id);
  [order[index], order[swapWith]] = [order[swapWith], order[index]];

  await db.batch(
    order.map((siblingId, i) =>
      db.prepare("UPDATE locations SET sort_order = ? WHERE id = ?").bind(i + 1, siblingId),
    ),
  );
}

/** Puts a level back to natural label order ("Section 2" before "Section 10"). */
export async function resetOrder(parentId: string | null): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      parentId === null
        ? "UPDATE locations SET sort_order = 0 WHERE parent_id IS NULL"
        : "UPDATE locations SET sort_order = 0 WHERE parent_id = ?",
    )
    .bind(...(parentId === null ? [] : [parentId]))
    .run();
}
