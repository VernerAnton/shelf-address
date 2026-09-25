import { apiError, NO_STORE, readJson } from "@/lib/api";
import { deleteCopy, setCondition } from "@/lib/copies";

/** Set or clear a copy's condition: { "condition": "torn jacket" | null }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/copies/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
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
