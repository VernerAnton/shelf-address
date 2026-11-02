import { NO_STORE } from "@/lib/api";
import { isLoggedIn } from "@/lib/extract-ai";
import { deleteText, saveText, SavedTextError, setDone } from "@/lib/saved-texts";

/**
 * One saved text (docs/spec-corrections.md §24). Needs the access-code login
 * (an HttpOnly, SameSite=Strict cookie, so other sites can't use it).
 *   PUT     { text, source, createdAt, updatedAt } from the phone — new or newer
 *   PATCH   { done } from the computer
 *   DELETE
 */
async function handle(request: Request, act: () => Promise<Response>): Promise<Response> {
  if (!(await isLoggedIn(request))) {
    return Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });
  }
  try {
    return await act();
  } catch (error) {
    if (error instanceof SavedTextError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Couldn't save it. It will be retried." }, { status: 500, headers: NO_STORE });
  }
}

async function json(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new SavedTextError("Expected JSON.", 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") throw new SavedTextError("Malformed JSON.");
  return body as Record<string, unknown>;
}

export async function PUT(request: Request, ctx: RouteContext<"/api/extract/texts/[id]">) {
  const { id } = await ctx.params;
  return handle(request, async () => Response.json({ saved: await saveText(id, await json(request)) }, { headers: NO_STORE }));
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/extract/texts/[id]">) {
  const { id } = await ctx.params;
  return handle(request, async () => {
    await setDone(id, (await json(request)).done === true);
    return Response.json({ ok: true }, { headers: NO_STORE });
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/extract/texts/[id]">) {
  const { id } = await ctx.params;
  return handle(request, async () => {
    await deleteText(id);
    return Response.json({ ok: true }, { headers: NO_STORE });
  });
}
