import { sendBook, takeBackBook } from "@/lib/bookops";
import { bookOpsRoute, ok } from "@/lib/bookops-api";

/**
 * The web store (docs/spec-corrections.md §27; lib/bookops-store.ts — a
 * stand-in for now). Needs the access-code login.
 *   POST    send the book to the web store, exactly as it stands
 *   DELETE  take it back, to change it
 */
export async function POST(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]/send">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => ok({ book: await sendBook(id) }));
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]/send">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => ok({ book: await takeBackBook(id) }));
}
