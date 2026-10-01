"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanIcon } from "@/components/icons";
import { antikvaariSearchUrl } from "@/lib/antikvaari";
import { kvGet, kvSet } from "@/lib/client/kv";
import { formatIsbn } from "@/lib/isbn";
import { CameraScanner } from "@/app/scan/_components/camera-scanner";
import { ManualEntry } from "@/app/scan/_components/manual-entry";

type Evaluated = { isbn13: string; at: string; title?: string | null };

/** Per phone: the fastest flow is the default; either step can be switched off. */
type Settings = { autoOpen: boolean; autoResume: boolean };
const DEFAULTS: Settings = { autoOpen: true, autoResume: true };

const RECENT_MAX = 20;
/** Coming back within this long counts as returning from that book's search. */
const AWAY_FOR_MS = 30 * 60 * 1000;
/** After coming back, the same book is ignored once for this long (it's still in front of the camera). */
const SKIP_FOR_MS = 30 * 1000;

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
 * for on Antikvaari.fi. Nothing is logged.
 *
 * Two switches, both on by default for speed:
 * - "Open Antikvaari straight after a scan": a scan goes straight to the
 *   search; off, it shows the book with an "Open on Antikvaari" button.
 * - "Start scanning again when I come back": returning from Antikvaari (Done
 *   / ✕ in the installed app, or Back in a browser tab) restarts the camera;
 *   off, the book waits on screen with "Scan next".
 *
 * With both on, the book is usually still in front of the camera when you
 * come back, and rescanning it would bounce straight back to Antikvaari. So
 * the first read of that same book after returning is ignored; move it away
 * and back to look it up again.
 */
export function EvaluateScreen() {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [current, setCurrent] = useState<Evaluated | null>(null);
  const [recent, setRecent] = useState<Evaluated[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const skip = useRef<{ isbn13: string; until: number } | null>(null);
  const settingsRef = useRef(settings);

  /** Back from Antikvaari: scan again, or keep the book on screen. */
  const comeBack = useCallback(async () => {
    const away = await kvGet<{ isbn13: string; at: string } | null>("evaluate:away");
    if (!away || Date.now() - Date.parse(away.at) > AWAY_FOR_MS) return;
    await kvSet("evaluate:away", null);
    if (!settingsRef.current.autoResume) return;
    skip.current = { isbn13: away.isbn13, until: Date.now() + SKIP_FOR_MS };
    setNote(null);
    setCurrent(null);
    await kvSet("evaluate:current", null);
  }, []);

  useEffect(() => {
    void Promise.all([
      kvGet<Evaluated[]>("evaluated"),
      kvGet<Evaluated | null>("evaluate:current"),
      kvGet<Settings>("evaluate:settings"),
    ]).then(async ([saved, inHand, stored]) => {
      const next = { ...DEFAULTS, ...stored };
      settingsRef.current = next;
      setSettings(next);
      const list = saved ?? [];
      setRecent(list);
      if (inHand && Date.now() - Date.parse(inHand.at) < AWAY_FOR_MS) setCurrent(inHand);
      // The page may have been reloaded on the way back (a browser tab).
      await comeBack();
      setLoaded(true);
      const titles = await titlesFor([...new Set(list.map((e) => e.isbn13))]);
      if (Object.keys(titles).length) setRecent((r) => r.map((e) => ({ ...e, title: titles[e.isbn13] ?? e.title })));
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void comeBack();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [comeBack]);

  /** Marks that we're going to Antikvaari for this book, so coming back is recognised. */
  const leaving = (isbn13: string) => kvSet("evaluate:away", { isbn13, at: new Date().toISOString() });

  const onIsbn = useCallback((isbn13: string) => {
    const skipping = skip.current;
    skip.current = null;
    if (skipping && skipping.isbn13 === isbn13 && Date.now() < skipping.until) {
      setNote("Same book as before — move it away and back to look it up again.");
      return;
    }
    setNote(null);
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
    void kvSet("evaluate:current", entry).then(async () => {
      if (!settingsRef.current.autoOpen) return;
      if (!navigator.onLine) {
        setNote("No signal, so Antikvaari didn't open. Tap the button when you're back online.");
        return;
      }
      await leaving(isbn13);
      // A moment for the beep and the card, then over to Antikvaari.
      setTimeout(() => window.location.assign(antikvaariSearchUrl(isbn13)), 250);
    });
  }, []);

  const scanNext = () => {
    skip.current = null;
    setNote(null);
    setCurrent(null);
    void kvSet("evaluate:current", null);
  };

  const change = (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    void kvSet("evaluate:settings", next);
  };

  if (!loaded) return <p className="text-muted">Loading…</p>;

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
            onClick={() => void leaving(current.isbn13)}
            className="flex h-14 items-center justify-center rounded-xl bg-accent text-lg font-medium text-accent-contrast"
          >
            Open on Antikvaari
          </a>
          {note && (
            <p role="status" className="rounded-lg border border-warn-line bg-warn-bg p-2 text-sm text-warn-text">
              {note}
            </p>
          )}
          <button
            type="button"
            onClick={scanNext}
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
          {note && (
            <p role="status" className="text-center text-sm text-muted">
              {note}
            </p>
          )}
          <ManualEntry disabled={false} onIsbn={onIsbn} submitLabel="Look up" />
        </>
      )}

      <section aria-label="Evaluate settings" className="overflow-hidden rounded-xl border border-line bg-surface text-sm">
        {(
          [
            ["autoOpen", "Open Antikvaari straight after a scan"],
            ["autoResume", "Start scanning again when I come back"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-0">
            <span>{label}</span>
            <input
              type="checkbox"
              role="switch"
              checked={settings[key]}
              onChange={(e) => change({ [key]: e.target.checked })}
              className="size-5 shrink-0 accent-[var(--color-accent)]"
            />
          </label>
        ))}
        <p className="px-4 py-3 text-xs text-muted">Saved on this phone only.</p>
      </section>

      {recent.length > 0 && (
        <section aria-label="Recently evaluated" className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Recently evaluated</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {recent.map((e) => (
              <li key={e.isbn13} className="border-b border-line last:border-0">
                <a
                  href={antikvaariSearchUrl(e.isbn13)}
                  onClick={() => void leaving(e.isbn13)}
                  className="flex min-h-12 items-center gap-3 px-4 py-2 active:bg-line/50"
                >
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
