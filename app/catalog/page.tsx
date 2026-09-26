import Link from "next/link";
import { catalogCounts, needsReview, recentlyLogged, searchCatalog } from "@/lib/catalog";
import { kickLookups } from "@/lib/editions";
import { CatalogResults } from "./_components/catalog-results";

export const dynamic = "force-dynamic";

/**
 * Catalog tab: type a title, author or ISBN, get back where every copy is.
 * Spec §1 item 4 — the point of the whole tool.
 */
export default async function CatalogPage(props: PageProps<"/catalog">) {
  const { q, review } = await props.searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 200) : "";
  const showReview = review === "1" && !query;

  const [hits, counts] = await Promise.all([
    query ? searchCatalog(query) : showReview ? needsReview() : recentlyLogged(),
    catalogCounts(),
  ]);
  // Anything still waiting for a title gets nudged along while we're here.
  if (hits.some((h) => h.edition.lookupStatus === "pending")) await kickLookups();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>

      <form action="/catalog" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Title, author or ISBN"
          aria-label="Search books"
          enterKeyHint="search"
          autoComplete="off"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        />
        <button type="submit" className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast">
          Search
        </button>
      </form>

      {query ? (
        <>
          <p className="px-1 text-sm text-muted">
            {hits.length === 0
              ? `Nothing logged matches “${query}”.`
              : `${hits.length} ${hits.length === 1 ? "book" : "books"} matching “${query}”`}
          </p>
          <CatalogResults hits={hits} />
        </>
      ) : showReview ? (
        <>
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold">Needs review ({hits.length})</h2>
            <Link href="/catalog" className="text-sm text-accent">
              Back
            </Link>
          </div>
          <p className="px-1 text-sm text-muted">
            Typed in by hand. Open a copy to check the details and mark it reviewed.
          </p>
          {hits.length > 0 ? (
            <CatalogResults hits={hits} />
          ) : (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">Nothing to review.</p>
          )}
        </>
      ) : (
        <>
          <p className="px-1 text-sm text-muted">
            {counts.copies} {counts.copies === 1 ? "copy" : "copies"} of {counts.editions}{" "}
            {counts.editions === 1 ? "book" : "books"} logged.
          </p>
          {counts.review > 0 && (
            <Link
              href="/catalog?review=1"
              className="flex h-12 items-center justify-between rounded-xl border border-warn-line bg-warn-bg px-4 text-sm font-medium text-warn-text"
            >
              Needs review ({counts.review})<span aria-hidden>›</span>
            </Link>
          )}
          {hits.length > 0 && (
            <>
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Recently logged</h2>
              <CatalogResults hits={hits} />
            </>
          )}
        </>
      )}
    </main>
  );
}
