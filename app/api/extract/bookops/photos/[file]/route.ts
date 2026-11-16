import { getPhoto } from "@/lib/bookops";
import { isLoggedIn } from "@/lib/extract-ai";

/**
 * A BookOps photo (front or back cover), from R2. Behind the access-code
 * login like the rest of BookOps. File names are timestamped when stored, so
 * each is immutable and the browser can keep it — privately.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/extract/bookops/photos/[file]">) {
  if (!(await isLoggedIn(request))) return new Response("Log in with the access code.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { file } = await ctx.params;
  const object = await getPhoto(file);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
