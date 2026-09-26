/*
 * Shelf-Address service worker (docs/spec-corrections.md §8): lets the Scan
 * tab open and work with no signal. Scans themselves are queued in IndexedDB
 * by the page and uploaded when the connection returns; this worker only
 * makes sure the page itself can load.
 *
 *   /_next/static/*   cache-first. Content-hashed, never change once built.
 *   page navigations  network-first, fall back to the last copy seen.
 *   /api/*            never cached — the page's upload queue handles failure.
 *   other files       stale-while-revalidate (icons, manifest).
 *
 * Cloudflare Access: an expired login makes the server answer a navigation
 * with a redirect to the login page. That's passed straight through and never
 * cached, so logging in keeps working normally.
 */

const VERSION = "v1";
const STATIC = `shelf-static-${VERSION}`;
const PAGES = `shelf-pages-${VERSION}`;
const STATIC_MAX_ENTRIES = 250;

// Pages worth having before the first time they're visited offline.
const PRECACHE = ["/scan", "/manifest.webmanifest", "/icons/icon-192.png", "/icon.svg"];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline — Shelf-Address</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f5f2;color:#1c1b19;margin:0;padding:2rem 1rem;max-width:28rem;margin-inline:auto}
a{display:inline-block;margin-top:1rem;padding:.8rem 1.2rem;border-radius:.75rem;background:#1d5c8c;color:#fff;text-decoration:none}</style>
</head><body><h1>No signal</h1>
<p>This page needs a connection. Scanning still works offline — books are saved on the phone and upload by themselves later.</p>
<a href="/scan">Go to Scan</a></body></html>`;

function cacheable(response) {
  return response && response.ok && response.type === "basic" && !response.redirected;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      // One by one, not addAll: a single failure (e.g. a login redirect)
      // mustn't stop the worker installing.
      await Promise.allSettled(
        PRECACHE.map(async (url) => {
          const response = await fetch(url, { cache: "no-cache" });
          if (cacheable(response)) await cache.put(url, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("shelf-") && name !== STATIC && name !== PAGES) await caches.delete(name);
      }
      // Old builds' hashed files pile up across deploys; keep the newest.
      const cache = await caches.open(STATIC);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - STATIC_MAX_ENTRIES))) {
        await cache.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(STATIC);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname; // ignore ?query for the offline copy
  try {
    // The navigation request passed through untouched: re-wrapping it (e.g. to
    // set cache options) changes its mode and redirect handling, which risks
    // breaking the Cloudflare Access login redirect in some browsers. Pages
    // carry no browser cache lifetime, so this still revalidates every time.
    const response = await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(PAGES);
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(key)) ||
      new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(PAGES);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (cacheable(response)) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;
  // Book covers: immutable and potentially thousands of them — left to the
  // browser's own HTTP cache rather than piled into this worker's caches.
  if (url.pathname.startsWith("/covers/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  } else if (request.headers.get("RSC") || url.searchParams.has("_rsc")) {
    // In-app navigation data: straight to the network. If it fails, Next
    // falls back to a full page load, which the navigate branch above serves.
    return;
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
