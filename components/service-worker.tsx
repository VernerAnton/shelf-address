"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which lets the Scan tab open with no signal.
 * Production builds only: under `next dev` a caching worker would serve stale
 * code while editing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the app works online without it.
    });
  }, []);
  return null;
}
