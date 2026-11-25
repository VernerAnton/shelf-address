import { NO_STORE } from "@/lib/api";
import { ExtractError, isLoggedIn, PHOTO_MAX_BYTES, readWithAi } from "@/lib/extract-ai";
import { addReading } from "@/lib/saved-texts";

/**
 * POST /api/extract with a back-cover photo as the body (image/jpeg): the
 * text, read by the AI (docs/spec-corrections.md §23). Needs the access code
 * login. Errors say `kind`: "login" (log in again) or "fallback" (read on the
 * phone instead). An image content type can't be sent cross-site without a
 * CORS preflight, which this never grants; the login cookie is SameSite=Strict.
 * With an `X-Text-Id` header, the photo and the answer are kept with that
 * saved text (§28); with `X-Reading-Id` too, under that id, so the phone can
 * fetch the answer again if it got lost (GET /api/extract/readings/<id>).
 */
export async function POST(request: Request) {
  try {
    if (!(await isLoggedIn(request))) throw new ExtractError("Log in with the access code to use AI reading.", 401, "login");
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > PHOTO_MAX_BYTES) throw new ExtractError("That photo is too large.", 413, "fallback");
    const photo = await request.arrayBuffer();
    const { text, details } = await readWithAi(photo, type);
    // Kept with the saved text it's for, so the reading can be reported from the computer (§28).
    const textId = request.headers.get("x-text-id");
    if (textId && /^[\w-]{8,64}$/.test(textId)) {
      await addReading(textId, photo, type, text, details, request.headers.get("x-reading-id")).catch((e) => console.error("keeping the reading", e));
    }
    return Response.json({ text, details }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExtractError) {
      return Response.json({ error: error.message, kind: error.kind }, { status: error.status, headers: NO_STORE });
    }
    console.error(error);
    return Response.json({ error: "Something went wrong reading it.", kind: "fallback" }, { status: 500, headers: NO_STORE });
  }
}
