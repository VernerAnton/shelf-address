"use client";

/**
 * The Scan screen's state, kept on the phone and synced to the server when
 * there's signal (docs/spec-corrections.md §8).
 *
 * Every change is written to IndexedDB *before* any upload is attempted, so a
 * scan is never lost to a dropped connection, a closed app or a flat battery.
 * Uploads go through the JSON API (not Server Actions, whose ids change on
 * every deploy and would strand scans queued before an update).
 */

import { useSyncExternalStore } from "react";
import { displayAddress } from "@/lib/address";
import type { Condition } from "@/lib/copy-model";
import { nearestAddressed, pathIn, type Location } from "@/lib/location-model";
import {
  coverUploadOf,
  discard,
  discardCover,
  enqueue,
  type EditionDetails,
  markFailed,
  markSent,
  nextToSend,
  photoIdsIn,
  retryCreateAt,
  type Op,
  type QueuedOp,
} from "@/lib/scan-queue";
import { kvDelete, kvGet, kvSet } from "./kv";

export type RecentScan = {
  copyId: string;
  /** Edition key: ISBN-13, or finna:/manual: for a book without one. */
  isbn13: string;
  /** Known at scan time for a book picked or typed in; otherwise from lookup. */
  title?: string | null;
  author?: string | null;
  locationId: string;
  /** Where it was logged, as shown at the time — survives the place being renamed or deleted. */
  placeName: string;
  scannedAt: string;
  condition: string | null;
};

export type PlacesSnapshot = { fetchedAt: string; locations: Location[] };

/** What the server has found out about a scanned book (lib/editions.ts). */
export type EditionSummary = {
  title: string | null;
  author: string | null;
  coverUrl: string | null;
  lookupStatus: "pending" | "found" | "not_found" | "skipped";
};

export type ScanState = {
  ready: boolean;
  queue: QueuedOp[];
  recent: RecentScan[];
  places: PlacesSnapshot | null;
  /** Titles and covers of recent scans, kept so they show offline too. */
  editions: Record<string, EditionSummary>;
  /** Cover photos taken on this phone and not uploaded yet, by edition key (object URLs). */
  localCovers: Record<string, string>;
  activePlaceId: string | null;
  online: boolean;
  syncing: boolean;
  /** Cloudflare Access sent a login page instead of an answer. */
  needsLogin: boolean;
};

const RECENT_MAX = 50;
const RETRY_EVERY_MS = 20_000;

let state: ScanState = {
  ready: false,
  queue: [],
  recent: [],
  places: null,
  editions: {},
  localCovers: {},
  activePlaceId: null,
  online: true,
  syncing: false,
  needsLogin: false,
};

const listeners = new Set<() => void>();

function set(patch: Partial<ScanState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/**
 * Writes the queue, recent scans and active place to IndexedDB. Every
 * exported mutator awaits startScanStore() first, so this can never write
 * the empty initial state over what's saved on the phone.
 */
async function persist() {
  await Promise.all([
    kvSet("queue", state.queue),
    kvSet("recent", state.recent),
    kvSet("activePlaceId", state.activePlaceId),
  ]);
}

/**
 * Replaces the queue, and tidies up after cover photos it no longer needs:
 * their stored bytes are deleted and their previews dropped.
 */
function setQueue(queue: QueuedOp[]) {
  const before = state.queue.flatMap((q) => (q.kind === "cover" ? [q] : []));
  const keep = photoIdsIn(queue);
  const localCovers = { ...state.localCovers };
  for (const op of before) {
    if (keep.has(op.photoId)) continue;
    void kvDelete(`photo:${op.photoId}`);
    if (!coverUploadOf(queue, op.isbn13) && localCovers[op.isbn13]) {
      URL.revokeObjectURL(localCovers[op.isbn13]);
      delete localCovers[op.isbn13];
    }
  }
  set({ queue, localCovers });
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/** "Row 2 · Store — Bulevard 1": the place, and the address it's found at. */
export function describePlace(places: PlacesSnapshot | null, id: string | null) {
  if (!places || !id) return null;
  const path = pathIn(places.locations, id);
  const place = path.at(-1);
  if (!place) return null;
  const site = path[0]?.kind === "site" ? path[0].label : null;
  const addressed = nearestAddressed(path);
  const address = addressed?.address ? displayAddress(addressed.address, site) : null;
  // The place's own name, then where it's found: its address (or the one it's
  // inside), else just the site.
  const name = [place.label, address ?? site].filter(Boolean).join(" · ");
  return { place, path, address, name };
}

/**
 * Fetches a fresh copy of the location tree for the offline place picker.
 * Returns false (keeping the old copy) when there's no signal.
 */
export async function refreshPlaces(): Promise<boolean> {
  const response = await request("GET", "/api/locations");
  if (response.kind !== "ok") return false;
  const places = response.body as PlacesSnapshot;
  await kvSet("places", places);
  set({ places });
  // The active place was deleted while we were away: don't keep logging to it.
  if (state.activePlaceId && !places.locations.some((l) => l.id === state.activePlaceId)) {
    set({ activePlaceId: null });
    await persist();
  }
  return true;
}

export async function setActivePlace(id: string | null) {
  await startScanStore();
  set({ activePlaceId: id });
  await persist();
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

async function apply(op: Op) {
  setQueue(enqueue(state.queue, op));
  await persist();
  void flush();
}

/**
 * Logs a copy at the active place. Saved on the phone at once. `key` is an
 * ISBN-13, or a finna:/manual: key with `details` for a book without one.
 */
export async function logScan(key: string, details?: EditionDetails): Promise<RecentScan> {
  await startScanStore();
  const locationId = state.activePlaceId;
  if (!locationId) throw new Error("No active place");
  const scan: RecentScan = {
    copyId: crypto.randomUUID(),
    isbn13: key,
    title: details?.title ?? null,
    author: details?.author ?? null,
    locationId,
    placeName: describePlace(state.places, locationId)?.name ?? "Unknown place",
    scannedAt: new Date().toISOString(),
    condition: null,
  };
  set({ recent: [scan, ...state.recent].slice(0, RECENT_MAX) });
  await apply({
    kind: "create",
    copyId: scan.copyId,
    isbn13: key,
    locationId,
    condition: null,
    scannedAt: scan.scannedAt,
    ...(details ? { edition: details } : {}),
  });
  return scan;
}

// ---------------------------------------------------------------------------
// Titles and covers
// ---------------------------------------------------------------------------

const settled = (e: EditionSummary | undefined) => e !== undefined && e.lookupStatus !== "pending";

/**
 * Fetches titles and covers for recent scans that don't have them yet. The
 * server looks books up after each upload, so a new scan shows its ISBN
 * first and its title a few seconds later.
 */
export async function refreshEditions(): Promise<void> {
  const keys = [...new Set(state.recent.map((r) => r.isbn13))].filter((k) => !settled(state.editions[k]));
  if (keys.length === 0 || !state.online) return;
  const response = await request("GET", `/api/editions?keys=${encodeURIComponent(keys.join(","))}`);
  if (response.kind !== "ok") return;
  const { editions } = response.body as { editions: ({ key: string } & EditionSummary)[] };
  const merged = { ...state.editions };
  for (const e of editions) {
    merged[e.key] = { title: e.title, author: e.author, coverUrl: e.coverUrl, lookupStatus: e.lookupStatus };
  }
  // Only keep what the recent list still shows.
  const live = new Set(state.recent.map((r) => r.isbn13));
  set({ editions: Object.fromEntries(Object.entries(merged).filter(([k]) => live.has(k))) });
  await kvSet("editions", state.editions);
}

export async function undoScan(copyId: string) {
  await startScanStore();
  set({ recent: state.recent.filter((r) => r.copyId !== copyId) });
  await apply({ kind: "delete", copyId });
}

export async function setScanCondition(copyId: string, condition: Condition | null) {
  await startScanStore();
  set({ recent: state.recent.map((r) => (r.copyId === copyId ? { ...r, condition } : r)) });
  await apply({ kind: "condition", copyId, condition });
}

/** A scan that failed (e.g. its place was deleted): log it at the active place instead. */
export async function retryScanHere(copyId: string) {
  await startScanStore();
  const locationId = state.activePlaceId;
  if (!locationId) return;
  setQueue(retryCreateAt(state.queue, copyId, locationId));
  set({
    recent: state.recent.map((r) =>
      r.copyId === copyId
        ? { ...r, locationId, placeName: describePlace(state.places, locationId)?.name ?? r.placeName }
        : r,
    ),
  });
  await persist();
  void flush();
}

export async function discardScan(copyId: string) {
  await startScanStore();
  setQueue(discard(state.queue, copyId));
  set({ recent: state.recent.filter((r) => r.copyId !== copyId) });
  await persist();
}

// ---------------------------------------------------------------------------
// Cover photos (§15)
// ---------------------------------------------------------------------------

/**
 * A cover photographed for a scanned book. Kept on the phone first, like a
 * scan, and uploaded after it; shown in the list straight away.
 */
export async function addCoverPhoto(copyId: string, key: string, photo: Blob) {
  await startScanStore();
  const photoId = crypto.randomUUID();
  await kvSet(`photo:${photoId}`, await photo.arrayBuffer());
  const localCovers = { ...state.localCovers };
  if (localCovers[key]) URL.revokeObjectURL(localCovers[key]);
  localCovers[key] = URL.createObjectURL(photo);
  set({ localCovers });
  await apply({ kind: "cover", copyId, isbn13: key, photoId });
}

/** Give up on a cover photo the server refused. */
export async function discardCoverPhoto(key: string) {
  await startScanStore();
  setQueue(discardCover(state.queue, key));
  await persist();
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "ok"; body: unknown }
  | { kind: "rejected"; error: string } // permanent: never retry as-is
  | { kind: "retry" } // offline, or a server hiccup
  | { kind: "login" }; // Cloudflare Access wants a fresh login

async function request(
  method: string,
  url: string,
  body?: unknown,
  raw?: { bytes: ArrayBuffer; type: string },
): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // Access answers an expired session with a redirect to its login page.
      // Following it would fail as a cross-origin error indistinguishable from
      // "no signal", and scans would wait forever. Catch it instead.
      redirect: "manual",
      credentials: "same-origin",
      headers: raw ? { "content-type": raw.type } : body === undefined ? undefined : { "content-type": "application/json" },
      body: raw ? raw.bytes : body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    set({ online: false });
    return { kind: "retry" };
  }
  set({ online: true });
  if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
    set({ needsLogin: true });
    return { kind: "login" };
  }
  set({ needsLogin: false });
  const json = (await response.json().catch(() => null)) as {
    permanent?: boolean;
    error?: string;
  } | null;
  if (response.ok) return { kind: "ok", body: json };
  if (json && json.permanent === true) {
    return { kind: "rejected", error: String(json.error ?? "Rejected by the server.") };
  }
  return { kind: "retry" };
}

async function send(op: QueuedOp): Promise<Outcome> {
  switch (op.kind) {
    case "cover": {
      const bytes = await kvGet<ArrayBuffer>(`photo:${op.photoId}`);
      if (!bytes) return { kind: "rejected", error: "The photo was lost on this phone. Take it again." };
      return request("PUT", `/api/editions/cover?key=${encodeURIComponent(op.isbn13)}`, undefined, {
        bytes,
        type: "image/jpeg",
      });
    }
    case "create":
      return request("POST", "/api/copies", {
        id: op.copyId,
        editionKey: op.isbn13,
        edition: op.edition,
        locationId: op.locationId,
        condition: op.condition,
        scannedAt: op.scannedAt,
      });
    case "delete":
      return request("DELETE", `/api/copies/${op.copyId}`);
    case "condition":
      return request("PATCH", `/api/copies/${op.copyId}`, { condition: op.condition });
  }
}

/**
 * Uploads everything waiting, oldest first. Stops at the first temporary
 * failure so order is kept; parks permanent failures and carries on.
 */
export async function flush(): Promise<void> {
  if (state.syncing) return;
  set({ syncing: true });
  let uploadedScan = false;
  try {
    for (let op = nextToSend(state.queue); op; op = nextToSend(state.queue)) {
      const outcome = await send(op);
      if (outcome.kind === "ok") {
        uploadedScan ||= op.kind === "create";
        if (op.kind === "cover") {
          // Show the stored cover from now on (it's the same picture).
          const url = (outcome.body as { url?: string } | null)?.url ?? null;
          const known = state.editions[op.isbn13] ?? { title: null, author: null, lookupStatus: "pending" as const };
          set({ editions: { ...state.editions, [op.isbn13]: { ...known, coverUrl: url } } });
          await kvSet("editions", state.editions);
        }
        setQueue(markSent(state.queue, op));
      } else if (outcome.kind === "rejected") {
        setQueue(markFailed(state.queue, op, outcome.error));
      } else {
        break;
      }
      await persist();
    }
  } finally {
    set({ syncing: false });
  }
  if (uploadedScan) {
    // The lookup runs on the server just after the upload; check back shortly.
    for (const delay of [2500, 7000, 15000]) setTimeout(() => void refreshEditions(), delay);
  }
}

// ---------------------------------------------------------------------------
// Startup and React binding
// ---------------------------------------------------------------------------

let started: Promise<void> | null = null;

/** Loads saved state and starts background syncing. Safe to call repeatedly. */
export function startScanStore(): Promise<void> {
  started ??= (async () => {
    const [queue, recent, places, activePlaceId, editions] = await Promise.all([
      kvGet<QueuedOp[]>("queue"),
      kvGet<RecentScan[]>("recent"),
      kvGet<PlacesSnapshot>("places"),
      kvGet<string | null>("activePlaceId"),
      kvGet<Record<string, EditionSummary>>("editions"),
    ]);
    // Previews for cover photos still waiting to upload.
    const localCovers: Record<string, string> = {};
    for (const op of queue ?? []) {
      if (op.kind !== "cover") continue;
      const bytes = await kvGet<ArrayBuffer>(`photo:${op.photoId}`);
      if (bytes) localCovers[op.isbn13] = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    }
    set({
      ready: true,
      localCovers,
      queue: queue ?? [],
      recent: recent ?? [],
      places: places ?? null,
      editions: editions ?? {},
      activePlaceId: activePlaceId ?? null,
      online: navigator.onLine,
    });

    const kick = () => void flush();
    window.addEventListener("online", () => {
      set({ online: true });
      kick();
      void refreshPlaces();
    });
    window.addEventListener("offline", () => set({ online: false }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") kick();
    });
    setInterval(() => {
      if (nextToSend(state.queue)) kick();
      else void refreshEditions();
    }, RETRY_EVERY_MS);

    void refreshPlaces();
    void refreshEditions();
    kick();
  })();
  return started;
}

export function useScanState(): ScanState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
