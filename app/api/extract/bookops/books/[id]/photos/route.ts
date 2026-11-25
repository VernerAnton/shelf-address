import { attachPhotos, BookOpsError, PHOTO_MAX_BYTES } from "@/lib/bookops";
import { bookOpsRoute, ok, photo } from "@/lib/bookops-api";

/**
 * POST: photos for a book already in the queue (docs/spec-corrections.md
 * §27), as a form: `front` and/or `back`, and `isbn` if the barcode was read
 * from the back. Only the sides the book doesn't have yet are kept; then
 * POST …/process reads it again. Needs the access-code login.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]/photos">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new BookOpsError("Expected a form.", 415);
    if (Number(request.headers.get("content-length") ?? 0) > 2 * PHOTO_MAX_BYTES + 100_000) throw new BookOpsError("Those photos are too large.", 413);
    const form = await request.formData().catch(() => null);
    if (!form) throw new BookOpsError("Malformed form.");
    const isbn = form.get("isbn");
    const book = await attachPhotos(id, {
      front: await photo(form.get("front")),
      back: await photo(form.get("back")),
      isbn: typeof isbn === "string" ? isbn.slice(0, 40) : null,
    });
    return ok({ book });
  });
}
