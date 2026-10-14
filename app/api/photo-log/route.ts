import { NO_STORE } from "@/lib/api";
import { addPhotoLog, listPhotoLog, parseMeta, PhotoLogError } from "@/lib/photo-log";

/**
 * Photo log (docs/spec-corrections.md §21).
 *
 * POST: one entry as multipart form data — `meta` (JSON), and `photo` and
 * `thumb` when there are any. The X-Photo-Log header means a plain form on
 * another site can't send one: a custom header needs a CORS preflight, which
 * this API never grants. Errors carry `permanent` like the rest of the API.
 *
 * GET: the newest entries, as JSON (for looking through them elsewhere).
 */
export async function POST(request: Request) {
  try {
    if (request.headers.get("x-photo-log") !== "1") throw new PhotoLogError("Missing header.", 400);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new PhotoLogError("Expected form data.", 400);
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(String(form.get("meta") ?? ""));
    } catch {
      // parseMeta reports it
    }
    const meta = parseMeta(raw);
    const file = (name: string) => {
      const value = form.get(name);
      return value instanceof File && value.size > 0 ? value : null;
    };
    await addPhotoLog(meta, file("photo"), file("thumb"));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PhotoLogError) {
      return Response.json({ error: error.message, permanent: true }, { status: error.status, headers: NO_STORE });
    }
    console.error(error);
    return Response.json({ error: "Couldn't save the log entry.", permanent: false }, { status: 500, headers: NO_STORE });
  }
}

export async function GET() {
  return Response.json({ entries: await listPhotoLog(500) }, { headers: NO_STORE });
}
