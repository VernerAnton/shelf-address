import { NO_STORE } from "@/lib/api";
import { isLoggedIn } from "@/lib/extract-ai";
import { getReading, SavedTextError } from "@/lib/saved-texts";

/**
 * GET: the AI's answer for a reading the phone started, by the id it gave it
 * (V31). For when the answer never reached the phone — the browser put the
 * page to sleep while the camera was open, say. 404 until it's there.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/extract/readings/[id]">) {
  if (!(await isLoggedIn(request))) {
    return Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  try {
    const reading = await getReading(id);
    if (!reading) return Response.json({ error: "Not read yet." }, { status: 404, headers: NO_STORE });
    return Response.json(reading, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SavedTextError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    throw error;
  }
}
