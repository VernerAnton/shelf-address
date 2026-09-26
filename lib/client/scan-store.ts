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
  discard,
  enqueue,
  markFailed,
  markSent,
  nextToSend,
  retryCreateAt,
  type Op,
  type QueuedOp,
} from "@/lib/scan-queue";
import { kvGet, kvSet } from "./kv";

export type RecentScan = {
  copyId: string;
  isbn13: string;
  locationId: string;
  /** Where it was logged, as shown at the time — survives the place being renamed or deleted. */
  placeName: string;
  scannedAt: string;
  condition: string | null;
};

export type PlacesSnapshot = { fetchedAt: string; locations: Location[] };

export type ScanState = {
  ready: boolean;
  queue: QueuedOp[];
  recent: RecentScan[];
  places: PlacesSnapshot | null;
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
  set({ queue: enqueue(state.queue, op) });
  await persist();
  void flush();
}

/** Logs a copy of `isbn13` at the active place. Saved on the phone at once. */
export async function logScan(isbn13: string): Promise<RecentScan> {
  await startScanStore();
  const locationId = state.activePlaceId;
  if (!locationId) throw new Error("No active place");
  const scan: RecentScan = {
    copyId: crypto.randomUUID(),
    isbn13,
    locationId,
    placeName: describePlace(state.places, locationId)?.name ?? "Unknown place",
    scannedAt: new Date().toISOString(),
    condition: null,
  };
  set({ recent: [scan, ...state.recent].slice(0, RECENT_MAX) });
  await apply({
    kind: "create",
    copyId: scan.copyId,
    isbn13,
    locationId,
    condition: null,
    scannedAt: scan.scannedAt,
  });
  return scan;
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
  set({
    queue: retryCreateAt(state.queue, copyId, locationId),
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
  set({
    queue: discard(state.queue, copyId),
    recent: state.recent.filter((r) => r.copyId !== copyId),
  });
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

async function request(method: string, url: string, body?: unknown): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // Access answers an expired session with a redirect to its login page.
      // Following it would fail as a cross-origin error indistinguishable from
      // "no signal", and scans would wait forever. Catch it instead.
      redirect: "manual",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
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

function send(op: QueuedOp): Promise<Outcome> {
  switch (op.kind) {
    case "create":
      return request("POST", "/api/copies", {
        id: op.copyId,
        isbn13: op.isbn13,
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
  try {
    for (let op = nextToSend(state.queue); op; op = nextToSend(state.queue)) {
      const outcome = await send(op);
      if (outcome.kind === "ok") {
        set({ queue: markSent(state.queue, op) });
      } else if (outcome.kind === "rejected") {
        set({ queue: markFailed(state.queue, op, outcome.error) });
      } else {
        break;
      }
      await persist();
    }
  } finally {
    set({ syncing: false });
  }
}

// ---------------------------------------------------------------------------
// Startup and React binding
// ---------------------------------------------------------------------------

let started: Promise<void> | null = null;

/** Loads saved state and starts background syncing. Safe to call repeatedly. */
export function startScanStore(): Promise<void> {
  started ??= (async () => {
    const [queue, recent, places, activePlaceId] = await Promise.all([
      kvGet<QueuedOp[]>("queue"),
      kvGet<RecentScan[]>("recent"),
      kvGet<PlacesSnapshot>("places"),
      kvGet<string | null>("activePlaceId"),
    ]);
    set({
      ready: true,
      queue: queue ?? [],
      recent: recent ?? [],
      places: places ?? null,
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
    }, RETRY_EVERY_MS);

    void refreshPlaces();
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
