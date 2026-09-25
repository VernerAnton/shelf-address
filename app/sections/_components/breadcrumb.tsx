"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export type Crumb = { href: string; label: string };

/**
 * §7 drill-down: the trail back up the tree. On a deep path it scrolls
 * sideways rather than wrapping, and opens scrolled to the end so the
 * current level is always the one in view.
 */
export function Breadcrumb({ crumbs, current }: { crumbs: Crumb[]; current: string }) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [crumbs, current]);

  return (
    <nav aria-label="Breadcrumb" className="-mx-4">
      <ol
        ref={ref}
        className="flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 py-1 text-sm [scrollbar-width:none]"
      >
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <Link
              href={crumb.href}
              className="rounded px-1 py-1 text-accent hover:underline"
            >
              {crumb.label}
            </Link>
            <span aria-hidden className="text-muted">›</span>
          </li>
        ))}
        <li aria-current="page" className="px-1 py-1 text-muted">
          {current}
        </li>
      </ol>
    </nav>
  );
}
