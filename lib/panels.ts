import { getDb } from "@/lib/cloudflare";
import { byDisplayOrder, canHavePanel, panelOwner, type Location } from "@/lib/location-model";
import { getPath, listAllLocations } from "@/lib/locations";

/**
 * Instruction panels (spec §3): one per shelf or addressed section, covering
 * everything inside it. A panel holds a "How to find a book here" text and a
 * short note per place inside, keyed by that place's id — so renaming a
 * section keeps its note, and a deleted section's note simply stops showing.
 */

export type Panel = {
  locationId: string;
  howToFind: string | null;
  notes: Record<string, string>;
  updatedAt: string;
};

export const HOW_TO_FIND_MAX = 4000;
export const NOTE_MAX = 500;

type PanelRow = { location_id: string; how_to_find: string | null; notes: string; updated_at: string };

function toPanel(row: PanelRow): Panel {
  let notes: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.notes);
    if (parsed && typeof parsed === "object") notes = parsed;
  } catch {
    // A malformed notes value shows as no notes rather than breaking the page.
  }
  return { locationId: row.location_id, howToFind: row.how_to_find, notes, updatedAt: row.updated_at };
}

export async function getPanel(locationId: string): Promise<Panel | null> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT location_id, how_to_find, notes, updated_at FROM panels WHERE location_id = ?")
    .bind(locationId)
    .first<PanelRow>();
  return row ? toPanel(row) : null;
}

/** A place inside a panel's owner, with its depth below the owner (1 = direct child). */
export type PanelEntry = { location: Location; depth: number };

/**
 * Every place inside `ownerId`, depth-first in display order — the "actual
 * existing children, whatever shape" the panel mirrors (§3). An addressed
 * section inside is listed but not entered: it has its own panel.
 */
export async function panelEntries(ownerId: string): Promise<PanelEntry[]> {
  const all = await listAllLocations();
  const out: PanelEntry[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const child of all.filter((l) => l.parentId === parentId).sort(byDisplayOrder)) {
      out.push({ location: child, depth });
      // An addressed section inside has its own panel for what's inside it.
      if (!canHavePanel(child)) walk(child.id, depth + 1);
    }
  };
  walk(ownerId, 1);
  return out;
}

export class PanelError extends Error {}

export async function savePanel(
  locationId: string,
  input: { howToFind: string; notes: Record<string, string> },
): Promise<void> {
  const db = await getDb();
  const path = await getPath(locationId);
  const place = path.at(-1);
  if (!place) throw new PanelError("This place no longer exists.");
  if (!canHavePanel(place)) throw new PanelError("Only shelves and sections with an address have instructions.");

  const howToFind = input.howToFind.trim();
  if (howToFind.length > HOW_TO_FIND_MAX) {
    throw new PanelError(`Keep "How to find a book here" under ${HOW_TO_FIND_MAX} characters.`);
  }
  // Only notes for places that are really inside this one, trimmed, non-empty.
  const inside = new Set((await panelEntries(locationId)).map((e) => e.location.id));
  const notes: Record<string, string> = {};
  for (const [id, raw] of Object.entries(input.notes)) {
    const note = raw.trim();
    if (!note || !inside.has(id)) continue;
    if (note.length > NOTE_MAX) throw new PanelError(`Keep each note under ${NOTE_MAX} characters.`);
    notes[id] = note;
  }

  await db
    .prepare(
      `INSERT INTO panels (location_id, how_to_find, notes, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(location_id) DO UPDATE SET
         how_to_find = excluded.how_to_find, notes = excluded.notes, updated_at = excluded.updated_at`,
    )
    .bind(locationId, howToFind || null, JSON.stringify(notes), new Date().toISOString())
    .run();
}

/**
 * The instructions that apply at a place: the governing panel (nearest shelf
 * or addressed section at or above it) and the notes for each level between
 * that owner and the place — e.g. at "Row 2" inside shelf Bulevard 1:
 * Bulevard 1's "How to find", plus the notes for Top section and Row 2.
 */
export type Guidance = {
  owner: Location;
  panel: Panel;
  trail: { location: Location; note: string }[];
};

export async function guidanceFor(path: Location[]): Promise<Guidance | null> {
  const owner = panelOwner(path);
  if (!owner) return null;
  const panel = await getPanel(owner.id);
  if (!panel) return null;
  const below = path.slice(path.findIndex((l) => l.id === owner.id) + 1);
  const trail = below
    .map((location) => ({ location, note: panel.notes[location.id] ?? "" }))
    .filter((t) => t.note);
  if (!panel.howToFind && trail.length === 0) return null;
  return { owner, panel, trail };
}
