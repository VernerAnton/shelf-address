import { apiError, NO_STORE, readJson } from "@/lib/api";
import { createCopy } from "@/lib/copies";
import { kickLookups } from "@/lib/editions";

/** Log one scanned copy. Idempotent on the client-generated `id`. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { created, editionKey } = await createCopy({
      id: body.id,
      editionKey: body.editionKey,
      isbn13: body.isbn13,
      edition: body.edition,
      locationId: body.locationId,
      condition: body.condition,
      scannedAt: body.scannedAt,
    });
    // Title, author and cover are fetched after the response, so the phone
    // is never kept waiting on Finna or Google (lib/editions.ts).
    await kickLookups(editionKey);
    return Response.json({ ok: true, created }, { status: created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
