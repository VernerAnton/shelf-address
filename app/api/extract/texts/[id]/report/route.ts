import { NO_STORE } from "@/lib/api";
import { isLoggedIn } from "@/lib/extract-ai";
import { reportText, SavedTextError } from "@/lib/saved-texts";

/**
 * POST { note? }: report a bad reading from the computer
 * (docs/spec-corrections.md §28). Its back-cover photos, what the AI sent
 * back and the text now go to the Photo log. Needs the access-code login.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/extract/texts/[id]/report">) {
  if (!(await isLoggedIn(request))) {
    return Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new SavedTextError("Expected JSON.", 415);
    const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
    const entries = await reportText(id, body?.note, request.headers.get("user-agent"));
    return Response.json({ ok: true, entries }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SavedTextError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Couldn't send the report. Try again." }, { status: 500, headers: NO_STORE });
  }
}
