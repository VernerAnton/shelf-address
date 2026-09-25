import { apiError, NO_STORE, readJson } from "@/lib/api";
import { createCopy } from "@/lib/copies";

/** Log one scanned copy. Idempotent on the client-generated `id`. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { created } = await createCopy({
      id: body.id,
      isbn13: body.isbn13,
      locationId: body.locationId,
      condition: body.condition,
      scannedAt: body.scannedAt,
    });
    return Response.json({ ok: true, created }, { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
