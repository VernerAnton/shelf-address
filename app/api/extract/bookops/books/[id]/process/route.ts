import { getCloudflareContext } from "@opennextjs/cloudflare";
import { processBook } from "@/lib/bookops";
import { bookOpsRoute, ok } from "@/lib/bookops-api";

/**
 * POST: does whatever is still pending for the book — the lookup by ISBN and
 * the AI reading (docs/spec-corrections.md §27) — and answers with the book
 * as it is afterwards. `?retry=1` first puts a failed reading back in line.
 * Called by the screen that added the book, and again by any BookOps screen
 * that sees it still waiting; a claim in the database keeps it to one at a time.
 *
 * The work is also handed to `waitUntil`, so it's finished even if the phone
 * that sent the photos leaves the page before the answer comes.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/extract/bookops/books/[id]/process">) {
  const { id } = await ctx.params;
  return bookOpsRoute(request, async () => {
    const work = processBook(id, { retry: new URL(request.url).searchParams.get("retry") === "1" });
    try {
      (await getCloudflareContext({ async: true })).ctx.waitUntil(work.catch(() => {}));
    } catch {
      // No execution context: the request itself carries the work.
    }
    return ok({ book: await work });
  });
}
