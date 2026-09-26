import { getBucket } from "@/lib/cloudflare";

/**
 * Cover images, served from R2 (spec §2.2: fetched once, never hotlinked).
 * File names are timestamped when stored, so each is immutable and can be
 * cached by the browser for good.
 */
export async function GET(_request: Request, ctx: RouteContext<"/covers/[file]">) {
  const { file } = await ctx.params;
  if (!/^[\w.-]+$/.test(file)) return new Response("Not found", { status: 404 });
  const object = await (await getBucket()).get(`covers/${file}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
