import Link from "next/link";
import { BookCover } from "@/components/book-cover";
import type { CatalogHit } from "@/lib/catalog";
import { keyLabel } from "@/lib/edition-key";

/** One card per edition: what it is, then where each copy of it is. */
export function CatalogResults({ hits }: { hits: CatalogHit[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {hits.map(({ edition, copies }) => (
        <li key={edition.key} className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex gap-3 p-3">
            <BookCover src={edition.coverUrl} size="md" alt="" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug break-words">
                {edition.title ?? <span className="font-mono">{keyLabel(edition.key)}</span>}
              </p>
              <p className="text-sm text-muted">{[edition.author, edition.year].filter(Boolean).join(" · ")}</p>
              <p className="font-mono text-xs text-muted">{keyLabel(edition.key)}</p>
              {edition.needsReview && (
                <p className="mt-1 inline-block rounded bg-warn-bg px-1.5 py-0.5 text-xs font-semibold text-warn-text">
                  Needs review
                </p>
              )}
            </div>
          </div>
          <ul aria-label={`Copies of ${edition.title ?? edition.key}`} className="border-t border-line">
            {copies.map((copy) => (
              <li key={copy.id} className="border-b border-line last:border-0">
                <Link href={`/copies/${copy.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 active:bg-line/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-accent">{copy.address ?? copy.trail}</span>
                    {(copy.place || copy.condition) && (
                      <span className="block truncate text-sm text-muted">
                        {[copy.address && copy.place, copy.condition].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="text-muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
