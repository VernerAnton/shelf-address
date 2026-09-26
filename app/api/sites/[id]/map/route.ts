import { NO_STORE } from "@/lib/api";
import { MapError, removeSiteMap, setSiteMap } from "@/lib/maps";

function fail(error: unknown): Response {
  if (error instanceof MapError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE });
  console.error(error);
  return Response.json({ error: "Couldn't save the map. Try again." }, { status: 500, headers: NO_STORE });
}

/**
 * Upload or replace a site's reference map (§5). The body is the image itself,
 * already downscaled on the phone. An image content type can't be sent by a
 * plain form on another site, and cross-site fetches need a CORS preflight
 * this never grants.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/sites/[id]/map">) {
  try {
    const { id } = await ctx.params;
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const url = await setSiteMap(id, type, await request.arrayBuffer());
    return Response.json({ url }, { headers: NO_STORE });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/sites/[id]/map">) {
  try {
    const { id } = await ctx.params;
    await removeSiteMap(id);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return fail(error);
  }
}
