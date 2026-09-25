import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import type { Copy } from "@/lib/copies";
import { formatIsbn } from "@/lib/isbn";

/** Books logged at exactly this place (books in places inside it show there). */
export function BooksHere({ copies }: { copies: Copy[] }) {
  if (copies.length === 0) return null;
  return (
    <section aria-label="Books here" className="flex flex-col gap-2">
      <h2 className="px-1 text-sm text-muted">
        {copies.length} {copies.length === 1 ? "book" : "books"} logged here
      </h2>
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {copies.map((copy) => (
          <li key={copy.id} className="border-b border-line last:border-0">
            <Link href={`/copies/${copy.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/50">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {copy.title ?? <span className="font-mono">{formatIsbn(copy.isbn13)}</span>}
                </span>
                <span className="block truncate text-sm text-muted">
                  {[copy.condition, new Date(copy.addedAt).toLocaleDateString()].filter(Boolean).join(" · ")}
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
