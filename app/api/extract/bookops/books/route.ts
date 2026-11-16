import { BookOpsError, createBook, listBooks, PHOTO_MAX_BYTES, type NewPhoto } from "@/lib/bookops";
import { bookOpsRoute, ok } from "@/lib/bookops-api";

/**
 * BookOps' books (docs/spec-corrections.md §27). Needs the access-code login.
 *   GET   the books, newest first
 *   POST  a new book, as a form: `id`, and `front` + `back` (the photos)
 *         and/or `isbn` with `isbnSource` ("barcode" read from the back
 *         photo, "typed" in the ISBN box). Stored at once; the filling-in is
 *         POST …/books/[id]/process.
 */
export async function GET(request: Request) {
  return bookOpsRoute(request, async () => ok({ books: await listBooks() }));
}

async function photo(value: FormDataEntryValue | null): Promise<NewPhoto | null> {
  if (!value || typeof value === "string") return null;
  if (value.size > PHOTO_MAX_BYTES) throw new BookOpsError("That photo is too large.", 413);
  return { type: value.type, bytes: await value.arrayBuffer() };
}

export async function POST(request: Request) {
  return bookOpsRoute(request, async () => {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new BookOpsError("Expected a form.", 415);
    // Two photos of at most PHOTO_MAX_BYTES, and a little room for the rest.
    if (Number(request.headers.get("content-length") ?? 0) > 2 * PHOTO_MAX_BYTES + 100_000) throw new BookOpsError("Those photos are too large.", 413);
    const form = await request.formData().catch(() => null);
    if (!form) throw new BookOpsError("Malformed form.");
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value.slice(0, 100) : "";
    };
    const book = await createBook({
      id: text("id"),
      isbn: text("isbn") || null,
      isbnSource: text("isbnSource") === "typed" ? "typed" : "barcode",
      front: await photo(form.get("front")),
      back: await photo(form.get("back")),
    });
    return ok({ book });
  });
}
