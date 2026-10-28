import { NO_STORE } from "@/lib/api";
import { aiConfigured, checkCode, currentCode, ExtractError, isLoggedIn, loginCookie } from "@/lib/extract-ai";

/**
 * Extract's access code (docs/spec-corrections.md §23).
 *   GET     { configured, loggedIn } for this phone
 *   POST    { code } — right: logged in on this phone; wrong: 401
 *   DELETE  log this phone out
 * JSON only, so a form on another site can't send it.
 */
export async function GET(request: Request) {
  const loggedIn = await isLoggedIn(request);
  // Browsers keep a cookie 400 days at most, so each visit renews it: a phone
  // that uses Extract now and then stays logged in for good.
  const headers: Record<string, string> = { ...NO_STORE };
  if (loggedIn) headers["set-cookie"] = await loginCookie(request, await currentCode());
  return Response.json({ configured: await aiConfigured(), loggedIn }, { headers });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415, headers: NO_STORE });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const typed = typeof body?.code === "string" ? body.code.slice(0, 200) : "";
  try {
    const code = await checkCode(request, typed);
    if (!code) return Response.json({ error: "That code isn't right." }, { status: 401, headers: NO_STORE });
    return Response.json({ loggedIn: true }, { headers: { ...NO_STORE, "set-cookie": await loginCookie(request, code) } });
  } catch (error) {
    if (error instanceof ExtractError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    throw error;
  }
}

export async function DELETE(request: Request) {
  return Response.json({ loggedIn: false }, { headers: { ...NO_STORE, "set-cookie": await loginCookie(request, null) } });
}
