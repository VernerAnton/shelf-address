import { apiError, NO_STORE, readJson } from "@/lib/api";
import { claimMissingCopy, deleteCopy, setCondition } from "@/lib/copies";

/**
 * { "condition": "K3" | null } sets or clears a copy's condition.
 * { "locationId", "replaces" } claims a missing copy (§16): the book scanned
 * at `locationId` as copy `replaces` is this one, so its address changes there.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/copies/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if ("replaces" in body) {
      const { claimed } = await claimMissingCopy(id, { locationId: body.locationId, replaces: body.replaces });
      return Response.json({ ok: true, claimed }, { headers: NO_STORE });
    }
    await setCondition(id, body.condition ?? null);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}

/** Remove a copy (undo a scan). Already gone counts as success. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/copies/[id]">) {
  try {
    const { id } = await ctx.params;
    await deleteCopy(id);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
