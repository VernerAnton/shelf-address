import { NO_STORE } from "@/lib/api";
import { CoverError, setCoverPhoto } from "@/lib/editions";

/**
 * A cover photographed on the phone: PUT /api/editions/cover?key=<edition key>
 * with the JPEG as the body. Used by the Scan tab's upload queue and the book
 * page. Errors carry `permanent` like the rest of the queue's API: a 4xx
 * won't succeed on retry, anything else might.
 *
 * An image content type can't be sent by a plain form on another site, and
 * cross-site fetches need a CORS preflight this never grants.
 */
export async function PUT(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  try {
    const type = request.headers.get("content-type")?.split(";")[0].trim() ?? "";
    const url = await setCoverPhoto(key, type, await request.arrayBuffer());
    return Response.json({ url }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CoverError) {
      return Response.json({ error: error.message, permanent: true }, { status: error.status, headers: NO_STORE });
    }
    console.error(error);
    return Response.json(
      { error: "Couldn't save the photo. It will be retried.", permanent: false },
      { status: 500, headers: NO_STORE },
    );
  }
}
