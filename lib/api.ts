import { CopyError } from "@/lib/copies";

/**
 * JSON API plumbing shared by the route handlers.
 *
 * Every error body carries `permanent`: true means "this request will never
 * succeed as sent, stop retrying and show the reason"; false means "try again
 * later". The Scan screen's offline queue depends on the distinction.
 */
export function apiError(error: unknown): Response {
  if (error instanceof CopyError) {
    return Response.json({ error: error.message, permanent: true }, { status: error.status });
  }
  console.error(error);
  return Response.json(
    { error: "Something went wrong on the server. It will be retried.", permanent: false },
    { status: 500 },
  );
}

/**
 * Reads a JSON body. Requiring the JSON content type also means a plain HTML
 * form on another site can't forge these requests: cross-site JSON needs a
 * CORS preflight, which this API never grants.
 */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new CopyError("Expected JSON.", 415);
  }
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new CopyError("Malformed JSON.", 400);
}

export const NO_STORE = { "Cache-Control": "no-store" };
