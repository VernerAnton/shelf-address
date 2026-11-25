import { NO_STORE } from "@/lib/api";
import { isLoggedIn } from "@/lib/extract-ai";
import { COVER_MAX_BYTES, getCover, SavedTextError, setCover } from "@/lib/saved-texts";

/**
 * A saved text's front cover (docs/spec-corrections.md §28). Needs the
 * access-code login (its cookie is sent for /api/extract/*, pictures too).
 *   PUT   the photo as the body (image/jpeg), from the phone; 404 if the
 *         text isn't on the server yet
 *   GET   the picture
 */
const loginNeeded = () => Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });

export async function PUT(request: Request, ctx: RouteContext<"/api/extract/texts/[id]/cover">) {
  if (!(await isLoggedIn(request))) return loginNeeded();
  const { id } = await ctx.params;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > COVER_MAX_BYTES) throw new SavedTextError("That photo is too large.", 413);
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    await setCover(id, type, await request.arrayBuffer());
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SavedTextError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Couldn't save the picture. It will be retried." }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/extract/texts/[id]/cover">) {
  if (!(await isLoggedIn(request))) return loginNeeded();
  const { id } = await ctx.params;
  const object = await getCover(id).catch(() => null);
  if (!object) return new Response("No front cover", { status: 404, headers: NO_STORE });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      // The page asks with ?v=<when it was taken>, so a new photo is a new address.
      "cache-control": "private, max-age=604800",
    },
  });
}
