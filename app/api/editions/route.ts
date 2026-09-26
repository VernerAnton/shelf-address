import { NO_STORE } from "@/lib/api";
import { getEditions, kickLookups } from "@/lib/editions";

/**
 * Titles, authors and covers for the Scan tab's recent scans:
 * GET /api/editions?keys=9789510230763,finna:keski.334708
 * Also nudges any pending lookups along.
 */
export async function GET(request: Request) {
  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 60);
  const editions = await getEditions(keys);
  if (editions.some((e) => e.lookupStatus === "pending")) await kickLookups();
  return Response.json({ editions }, { headers: NO_STORE });
}
