import { NO_STORE } from "@/lib/api";
import { BookOpsError } from "@/lib/bookops";
import { isLoggedIn } from "@/lib/extract-ai";

/**
 * Shared by BookOps' route handlers (app/api/extract/bookops): every one of
 * them needs the access-code login — the cookie is HttpOnly, SameSite=Strict
 * and only sent under /api/extract, so other sites can't use it — and answers
 * a BookOpsError with its own message and status.
 */
export async function bookOpsRoute(request: Request, act: () => Promise<Response>): Promise<Response> {
  if (!(await isLoggedIn(request))) {
    return Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });
  }
  try {
    return await act();
  } catch (error) {
    if (error instanceof BookOpsError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Something went wrong on the server. Try again." }, { status: 500, headers: NO_STORE });
  }
}

export async function bookOpsJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BookOpsError("Expected JSON.", 415);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BookOpsError("Malformed JSON.");
  return body as Record<string, unknown>;
}

export const ok = (body: unknown) => Response.json(body, { headers: NO_STORE });
