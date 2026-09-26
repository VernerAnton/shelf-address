import { getBucket } from "@/lib/cloudflare";

/**
 * Site reference maps, served from R2 (§5). Each upload gets a new timestamped
 * name, so a file never changes and can be cached for good.
 */
export async function GET(_request: Request, ctx: RouteContext<"/maps/[file]">) {
  const { file } = await ctx.params;
  if (!/^[\w.-]+$/.test(file)) return new Response("Not found", { status: 404 });
  const object = await (await getBucket()).get(`maps/${file}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
