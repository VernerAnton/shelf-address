"use client";

import { useEffect, useRef, useState } from "react";
import { APP_VERSION, BUILD_ID } from "@/lib/version";

/** The backstop. The visibility check below does nearly all the work. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

// public/sw.js, as emitted into .open-next/assets by the build. A wrong path
// rejects into a silent catch, so it's verified at runtime, not by reading this.
const SW_URL = "/sw.js";
const SW_SCOPE = "/";

type Newer = { version: number };

/**
 * Registers the service worker, and tells the person when a newer build has
 * been deployed than the one this page is running — offering a reload, never
 * doing one unasked (it would throw away a half-typed form or a scan in
 * progress).
 *
 * How "newer" is detected, deliberately: by asking the server which build it's
 * running (/api/version) and comparing with the build compiled into this page.
 * NOT by waiting for the service worker to change: public/sw.js is hand-written
 * and byte-identical across deploys, so the browser never sees an "update" and
 * a worker-event approach would report "up to date" forever. See CLAUDE.md.
 */
export function AppUpdate() {
  const [offer, setOffer] = useState<Newer | null>(null);
  // Survives "Later": the page doesn't stop being behind because the offer was
  // waved away, and with no signal the next check can't re-confirm it. Only a
  // reload clears it.
  const stale = useRef<Newer | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(SW_URL, { scope: SW_SCOPE })
        .then((reg) => {
          registration = reg;
        })
        .catch(() => {
          // Not fatal: the app works online without it, just not offline.
        });
    }

    const check = async () => {
      // Picks up a changed sw.js promptly too (only happens when its own
      // caching logic is edited; it's not how builds are detected).
      registration?.update().catch(() => {});
      try {
        const response = await fetch("/api/version", {
          cache: "no-store",
          credentials: "same-origin",
          // An expired Cloudflare Access login answers with a redirect; that
          // says nothing about the build, so it's ignored rather than followed.
          redirect: "manual",
        });
        if (response.ok) {
          const server = (await response.json()) as { version: number; buildId: string };
          if (server.buildId !== BUILD_ID) stale.current = { version: server.version };
        }
      } catch {
        // No signal: can't tell. Keep whatever was known before.
      }
      if (stale.current && !cancelled) setOffer(stale.current);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    // Visibility is the mechanism: an installed app is switched back to far
    // more often than it's opened cold. Coming back into signal (the
    // warehouse) is the other moment worth checking.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    void check();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
      window.clearInterval(timer);
    };
  }, []);

  if (!offer) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 mx-auto max-w-md rounded-xl border border-line bg-surface p-4 shadow-lg"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {offer.version > APP_VERSION
              ? `A newer version (V${offer.version}) is ready.`
              : "A newer version is ready."}
          </p>
          <p className="text-sm text-muted">You&apos;re on V{APP_VERSION}.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOffer(null)}
            className="h-10 flex-1 rounded-lg border border-line px-4 text-sm font-medium sm:flex-none"
          >
            Later
          </button>
          <button
            type="button"
            // Pages are network-first in the service worker, so a plain reload
            // with signal lands on the new build.
            onClick={() => window.location.reload()}
            className="h-10 flex-1 rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast sm:flex-none"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
