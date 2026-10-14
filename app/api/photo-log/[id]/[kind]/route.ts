import { photoLogImage } from "@/lib/photo-log";

/** GET /api/photo-log/<id>/photo or /thumb: the stored image. */
export async function GET(_request: Request, ctx: RouteContext<"/api/photo-log/[id]/[kind]">) {
  const { id, kind } = await ctx.params;
  if (kind !== "photo" && kind !== "thumb") return new Response("Not found", { status: 404 });
  const object = await photoLogImage(id, kind);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // Stored once and never changed; private so shared caches don't keep them.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
