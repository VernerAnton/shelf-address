import { deleteBook, editBook } from "@/lib/bookops";
import { bookOpsJson, bookOpsRoute, ok } from "@/lib/bookops-api";

/**
 * One BookOps book (docs/spec-corrections.md §27). Needs the access-code login.
 *   PATCH   what was typed at the desk: any of { title, author, publisher,
 *           year, description, location, price ("14,50"), condition, quantity,
 *           isbn }. A field typed here is never filled in by the app again.
 *   DELETE  the book and its photos (not while it's in the web store)
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => ok({ book: await editBook(id, await bookOpsJson(request)) }));
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => {
    await deleteBook(id);
    return ok({ ok: true });
  });
}
