import { NO_STORE } from "@/lib/api";
import { deletePhotoLog } from "@/lib/photo-log";

/** DELETE /api/photo-log/<id>: removes an entry and its photos. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/photo-log/[id]">) {
  const { id } = await ctx.params;
  // Same guard as POST: a custom header needs a CORS preflight, so other sites can't send this.
  if (request.headers.get("x-photo-log") !== "1") {
    return Response.json({ error: "Missing header.", permanent: true }, { status: 400, headers: NO_STORE });
  }
  await deletePhotoLog(id);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
