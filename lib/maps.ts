import { getBucket, getDb } from "@/lib/cloudflare";
import { IMAGE_TYPES, imageProblem } from "@/lib/images";

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

export async function setSiteMap(siteId: string, type: string, body: ArrayBuffer): Promise<string> {
  const problem = imageProblem(type, body, MAP_MAX_BYTES);
  if (problem) throw new MapError(problem);
  const ext = IMAGE_TYPES[type];

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
