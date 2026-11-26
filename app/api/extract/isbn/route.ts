import { NO_STORE } from "@/lib/api";
import { ExtractError, isLoggedIn, PHOTO_MAX_BYTES, readIsbnWithAi } from "@/lib/extract-ai";
import { parseIsbn } from "@/lib/isbn";

/**
 * POST a photo (image/jpeg): the book's ISBN in it, read by the AI
 * (docs/spec-corrections.md §35) — for a printed ISBN the phone's own barcode
 * reader can't see. `{ isbn13 }`, or `{ isbn13: null }` if there's none (or the
 * digits don't check out). Needs the access-code login.
 */
export async function POST(request: Request) {
  try {
    if (!(await isLoggedIn(request))) throw new ExtractError("Log in with the access code to use AI reading.", 401, "login");
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (Number(request.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) throw new ExtractError("That photo is too large.", 413, "fallback");
    const { answer, ms } = await readIsbnWithAi(await request.arrayBuffer(), type);
    const digits = answer.replace(/[^\dX]/gi, "");
    const parsed = /NONE/i.test(answer) || !digits ? null : parseIsbn(digits);
    return Response.json({ isbn13: parsed?.ok ? parsed.isbn13 : null, answer, ms }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExtractError) return Response.json({ error: error.message, kind: error.kind }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Something went wrong reading it." }, { status: 500, headers: NO_STORE });
  }
}
