"use client";

/**
 * The phone's side of the photo log (docs/spec-corrections.md §21). Each entry
 * is saved on the phone first, then uploaded; without signal it waits and
 * goes up later, like a scan. It never holds up the photo button: logging is
 * troubleshooting, not part of the job.
 */

import type { PhotoLogMeta } from "@/lib/photo-log";
import { APP_VERSION } from "@/lib/version";
import { kvDelete, kvGet, kvSet } from "./kv";

const SWITCH_KEY = "photo-log";
const PENDING_KEY = "photo-log:pending";
/** Photos are a few MB each; past this many waiting, the oldest are dropped. */
const MAX_PENDING = 30;

type Saved = { meta: PhotoLogMeta; photo: Blob | null; thumb: Blob | null };

/** On by default; switched per phone on the Photo log page. */
export function photoLogOn(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPhotoLogOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(SWITCH_KEY);
    else localStorage.setItem(SWITCH_KEY, "off");
  } catch {
    // Private mode: stays on.
  }
}

export type NewEntry = Omit<PhotoLogMeta, "id" | "screen" | "userAgent" | "appVersion"> & { id?: string };

/** Saves an entry on the phone (that's all that's waited for) and uploads it in the background. */
export async function logPhoto(entry: NewEntry, photo: Blob | null, thumb: Blob | null): Promise<void> {
  if (!photoLogOn()) return;
  const meta: PhotoLogMeta = {
    ...entry,
    id: entry.id ?? crypto.randomUUID(),
    screen: location.pathname,
    userAgent: navigator.userAgent,
    appVersion: APP_VERSION,
  };
  const pending = (await kvGet<string[]>(PENDING_KEY)) ?? [];
  const keep = [...pending, meta.id];
  for (const dropped of keep.splice(0, Math.max(0, keep.length - MAX_PENDING))) await kvDelete(`photo-log:${dropped}`);
  await kvSet(`photo-log:${meta.id}`, { meta, photo, thumb });
  await kvSet(PENDING_KEY, keep);
  void flushPhotoLog();
}

export async function pendingPhotoLogCount(): Promise<number> {
  return ((await kvGet<string[]>(PENDING_KEY)) ?? []).length;
}

let flushing: Promise<void> | null = null;

/**
 * Uploads whatever is waiting, oldest first, including entries added while
 * it runs. Safe to call any time; stops at the first failure (no signal).
 */
export function flushPhotoLog(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (;;) {
        const [id] = (await kvGet<string[]>(PENDING_KEY)) ?? [];
        if (!id) return;
        const saved = await kvGet<Saved>(`photo-log:${id}`);
        if (saved) {
          const form = new FormData();
          form.set("meta", JSON.stringify(saved.meta));
          if (saved.photo) form.set("photo", saved.photo, "photo");
          if (saved.thumb) form.set("thumb", saved.thumb, "thumb.jpg");
          let response: Response;
          try {
            response = await fetch("/api/photo-log", { method: "POST", body: form, headers: { "X-Photo-Log": "1" }, redirect: "manual" });
          } catch {
            return; // no signal: try again later
          }
          const permanent = !response.ok && ((await response.json().catch(() => null)) as { permanent?: boolean } | null)?.permanent;
          if (!response.ok && !permanent) return;
        }
        // Uploaded, or refused for good (nothing to gain by keeping it).
        await kvDelete(`photo-log:${id}`);
        await kvSet(PENDING_KEY, ((await kvGet<string[]>(PENDING_KEY)) ?? []).filter((x) => x !== id));
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

if (typeof window !== "undefined") window.addEventListener("online", () => void flushPhotoLog());
