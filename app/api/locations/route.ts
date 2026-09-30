import { NO_STORE } from "@/lib/api";
import { getDb } from "@/lib/cloudflare";
import { listMissing } from "@/lib/reviews";

/**
 * The whole location tree in one response. The Scan screen keeps a copy on
 * the phone so the place picker still works with no signal (spec-corrections
 * §8). Small by nature: one row per site, shelf and section.
 *
 * Also carries the copies marked missing by reviews (§16), so a scan anywhere
 * can ask "is this the copy missing from Row 3?" even with no signal.
 */
export async function GET() {
  const db = await getDb();
  const [{ results }, missing] = await Promise.all([
    db
      .prepare("SELECT id, parent_id, kind, label, address, sort_order FROM locations")
      .all<{
        id: string;
        parent_id: string | null;
        kind: "site" | "shelf" | "node";
        label: string;
        address: string | null;
        sort_order: number;
      }>(),
    listMissing(),
  ]);
  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      locations: results.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        kind: r.kind,
        label: r.label,
        address: r.address,
        sortOrder: r.sort_order,
      })),
      missing,
    },
    { headers: NO_STORE },
  );
}
