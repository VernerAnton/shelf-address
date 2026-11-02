import { NO_STORE } from "@/lib/api";
import { isLoggedIn } from "@/lib/extract-ai";
import { listTexts } from "@/lib/saved-texts";

/** GET: the saved texts, newest first (docs/spec-corrections.md §24). Needs the access-code login. */
export async function GET(request: Request) {
  if (!(await isLoggedIn(request))) {
    return Response.json({ error: "Log in with the access code.", kind: "login" }, { status: 401, headers: NO_STORE });
  }
  return Response.json({ texts: await listTexts() }, { headers: NO_STORE });
}
