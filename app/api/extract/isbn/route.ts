import { NO_STORE } from "@/lib/api";
import { ExtractError, isLoggedIn, PHOTO_MAX_BYTES, readIsbnWithAi } from "@/lib/extract-ai";
import { isbnsInAnswer } from "@/lib/isbn";

/**
 * POST a photo (image/jpeg): the book's ISBNs in it, read by the AI
 * (docs/spec-corrections.md §35, §36) — for a printed ISBN the phone's own
 * barcode reader can't see. `{ isbns: [...] }`: each checked with the ISBN
 * check digit, as ISBN-13, the same book number only once (an old book's
 * 10- and 13-digit forms of one ISBN count once), at most two. `isbn13` is the
 * first, as before. Needs the access-code login.
 */
export async function POST(request: Request) {
  try {
    if (!(await isLoggedIn(request))) throw new ExtractError("Log in with the access code to use AI reading.", 401, "login");
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (Number(request.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES) throw new ExtractError("That photo is too large.", 413, "fallback");
    const { answer, ms } = await readIsbnWithAi(await request.arrayBuffer(), type);
    const isbns = isbnsInAnswer(answer);
    return Response.json({ isbns, isbn13: isbns[0] ?? null, answer, ms }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ExtractError) return Response.json({ error: error.message, kind: error.kind }, { status: error.status, headers: NO_STORE });
    console.error(error);
    return Response.json({ error: "Something went wrong reading it." }, { status: 500, headers: NO_STORE });
  }
}
