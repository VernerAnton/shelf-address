"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRightIcon, ShelfIcon } from "@/components/icons";
import type { AddressedShelf } from "@/lib/location-model";

/** §7 open item #6, confirmed: every shelf address across all sites, A–Z. */
export function AddressDirectory({ shelves }: { shelves: AddressedShelf[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("fi-FI");
    if (!q) return shelves;
    return shelves.filter((s) =>
      [s.address, s.label, s.siteLabel ?? ""].some((field) =>
        field.toLocaleLowerCase("fi-FI").includes(q),
      ),
    );
  }, [query, shelves]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Filter ${shelves.length} ${shelves.length === 1 ? "address" : "addresses"}`}
        aria-label="Filter addresses"
        className="h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
      />
      {visible.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {visible.map((shelf) => (
            <li key={shelf.id} className="border-b border-line last:border-0">
              <Link
                href={`/sections/${shelf.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-line/50"
              >
                <ShelfIcon className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{shelf.address}</span>
                  <span className="block truncate text-sm text-muted">
                    {shelf.siteLabel ?? "No site"} · {shelf.label}
                  </span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-center text-sm text-muted">No address matches “{query}”.</p>
      )}
    </div>
  );
}
