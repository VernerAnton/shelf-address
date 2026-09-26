import { getBucket, getDb } from "@/lib/cloudflare";

/**
 * Site reference maps (spec §5): one photo per site — a hand-drawn sketch, a
 * floor plan — purely a memory aid, tied to nothing else in the data.
 *
 * Stored in R2 under maps/<site id>-<timestamp>.jpg. The timestamp makes each
 * upload a new, immutable file (cacheable forever); replacing a map deletes
 * the old one.
 */

/** After the phone's downscale a map is a few hundred KB; this is the ceiling. */
export const MAP_MAX_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class MapError extends Error {}

/** The public path of a site's map, or null if it has none. */
export async function getSiteMap(siteId: string): Promise<string | null> {
  const row = await (await getDb())
    .prepare("SELECT map_image_id FROM locations WHERE id = ? AND kind = 'site'")
    .bind(siteId)
    .first<{ map_image_id: string | null }>();
  return mapUrl(row?.map_image_id ?? null);
}

export function mapUrl(key: string | null): string | null {
  return key ? `/${key}` : null;
}

/** Checks the first bytes really are the image type claimed. */
function looksLike(type: string, bytes: Uint8Array): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, j) => bytes[i + j] === v);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return false;
}

export async function setSiteMap(siteId: string, type: string, body: ArrayBuffer): Promise<string> {
  const ext = TYPES[type];
  if (!ext) throw new MapError("That isn't a photo this can store (JPEG, PNG or WebP).");
  if (body.byteLength === 0) throw new MapError("The photo arrived empty. Try again.");
  if (body.byteLength > MAP_MAX_BYTES) throw new MapError("That photo is too large. Try a smaller one.");
  if (!looksLike(type, new Uint8Array(body, 0, Math.min(12, body.byteLength)))) {
    throw new MapError("That file doesn't look like a photo.");
  }

  const db = await getDb();
  const site = await db
    .prepare("SELECT kind, map_image_id FROM locations WHERE id = ?")
    .bind(siteId)
    .first<{ kind: string; map_image_id: string | null }>();
  if (!site) throw new MapError("This place no longer exists.");
  if (site.kind !== "site") throw new MapError("Only a store or warehouse (a site) has a map.");

  const bucket = await getBucket();
  const key = `maps/${siteId}-${Date.now()}.${ext}`;
  await bucket.put(key, body, { httpMetadata: { contentType: type } });
  await db.prepare("UPDATE locations SET map_image_id = ? WHERE id = ?").bind(key, siteId).run();
  if (site.map_image_id) await bucket.delete(site.map_image_id);
  return mapUrl(key)!;
}

export async function removeSiteMap(siteId: string): Promise<void> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT map_image_id FROM locations WHERE id = ?")
    .bind(siteId)
    .first<{ map_image_id: string | null }>();
  if (!row?.map_image_id) return;
  await db.prepare("UPDATE locations SET map_image_id = NULL WHERE id = ?").bind(siteId).run();
  await (await getBucket()).delete(row.map_image_id);
}
