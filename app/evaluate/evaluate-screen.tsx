"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanIcon } from "@/components/icons";
import { antikvaariSearchUrl } from "@/lib/antikvaari";
import { kvGet, kvSet } from "@/lib/client/kv";
import { formatIsbn } from "@/lib/isbn";
import { CameraScanner } from "@/app/scan/_components/camera-scanner";
import { ManualEntry } from "@/app/scan/_components/manual-entry";

type Evaluated = { isbn13: string; at: string; title?: string | null };

const RECENT_MAX = 20;

/** Titles for books already in the app's catalogue; others show their ISBN. */
async function titlesFor(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  try {
    const response = await fetch(`/api/editions?keys=${encodeURIComponent(keys.join(","))}`, { redirect: "manual", cache: "no-store" });
    if (!response.ok) return {};
    const { editions } = (await response.json()) as { editions: { key: string; title: string | null }[] };
    return Object.fromEntries(editions.filter((e) => e.title).map((e) => [e.key, e.title as string]));
  } catch {
    return {};
  }
}

/**
 * Evaluate (docs/spec-corrections.md §17): scan a book, then see what it sells
 * for on Antikvaari.fi. Opens straight to the camera. A scan stops the camera
 * and offers one big link; Antikvaari opens over the app (Done / ✕ comes
 * back here) and "Scan next" starts the camera again. Nothing is logged.
 */
export function EvaluateScreen() {
  const [current, setCurrent] = useState<Evaluated | null>(null);
  const [recent, setRecent] = useState<Evaluated[]>([]);

  useEffect(() => {
    void kvGet<Evaluated[]>("evaluated").then(async (saved) => {
      const list = saved ?? [];
      setRecent(list);
      const titles = await titlesFor([...new Set(list.map((e) => e.isbn13))]);
      if (Object.keys(titles).length) setRecent((r) => r.map((e) => ({ ...e, title: titles[e.isbn13] ?? e.title })));
    });
  }, []);

  const onIsbn = useCallback((isbn13: string) => {
    const entry: Evaluated = { isbn13, at: new Date().toISOString() };
    setCurrent(entry);
    setRecent((r) => {
      const next = [entry, ...r.filter((e) => e.isbn13 !== isbn13)].slice(0, RECENT_MAX);
      void kvSet("evaluated", next.map(({ isbn13, at }) => ({ isbn13, at })));
      return next;
    });
    void titlesFor([isbn13]).then((titles) => {
      const title = titles[isbn13];
      if (!title) return;
      setCurrent((c) => (c?.isbn13 === isbn13 ? { ...c, title } : c));
      setRecent((r) => r.map((e) => (e.isbn13 === isbn13 ? { ...e, title } : e)));
    });
  }, []);

  return (
    <>
      {current ? (
        <section aria-label="Scanned book" className="flex flex-col gap-3 rounded-xl border-2 border-accent bg-surface p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scanned</p>
            {current.title && <p className="text-lg font-semibold leading-snug">{current.title}</p>}
            <p className={current.title ? "font-mono text-sm text-muted" : "font-mono text-lg font-semibold"}>
              {formatIsbn(current.isbn13)}
            </p>
          </div>
          <a
            href={antikvaariSearchUrl(current.isbn13)}
            className="flex h-14 items-center justify-center rounded-xl bg-accent text-lg font-medium text-accent-contrast"
          >
            Open on Antikvaari
          </a>
          <button
            type="button"
            onClick={() => setCurrent(null)}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-medium"
          >
            <ScanIcon className="size-5" />
            Scan next
          </button>
          <p className="text-sm text-muted">Antikvaari opens over the app. Tap Done (iPhone) or ✕ (Android) to come back here.</p>
        </section>
      ) : (
        <>
          <p className="text-sm text-muted">Scan a book to see what it sells for on Antikvaari.fi. Nothing is logged.</p>
          <CameraScanner disabled={false} autoStart onIsbn={onIsbn} />
          <ManualEntry disabled={false} onIsbn={onIsbn} />
        </>
      )}

      {recent.length > 0 && (
        <section aria-label="Recently evaluated" className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Recently evaluated</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {recent.map((e) => (
              <li key={e.isbn13} className="border-b border-line last:border-0">
                <a href={antikvaariSearchUrl(e.isbn13)} className="flex min-h-12 items-center gap-3 px-4 py-2 active:bg-line/50">
                  <span className="min-w-0 flex-1">
                    {e.title && <span className="block truncate font-medium">{e.title}</span>}
                    <span className={e.title ? "block font-mono text-xs text-muted" : "block font-mono font-medium"}>
                      {formatIsbn(e.isbn13)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-accent">Antikvaari ›</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
