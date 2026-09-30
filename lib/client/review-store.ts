"use client";

/**
 * The review in progress (docs/spec-corrections.md §16), kept on the phone so
 * it survives closing the app, a flat battery or no signal. Starting a review
 * needs signal once, for the list of what's logged at the place; after that
 * everything happens on the phone, and the saved review uploads through the
 * Scan tab's queue like a scan.
 */

import { useSyncExternalStore } from "react";
import { answer, evaluate, payloadOf, type ReviewSession } from "@/lib/review";
import type { ReviewSnapshot } from "@/lib/reviews";
import { kvGet, kvSet } from "./kv";
import { queueReview } from "./scan-store";

export type ReviewState = {
  ready: boolean;
  session: ReviewSession | null;
  starting: boolean;
  /** Titles for books scanned in the review that aren't in its list (when known). */
  titles: Record<string, string>;
  /** Shown after saving: what the review did. */
  saved: { placeName: string; found: number; added: number; relocated: number; removed: number; pending: number } | null;
};

let state: ReviewState = { ready: false, session: null, starting: false, titles: {}, saved: null };
const listeners = new Set<() => void>();

function set(patch: Partial<ReviewState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function persist() {
  await kvSet("review", state.session);
}

let started: Promise<void> | null = null;
export function startReviewStore(): Promise<void> {
  started ??= (async () => {
    const session = (await kvGet<ReviewSession | null>("review")) ?? null;
    set({ ready: true, session });
  })();
  return started;
}

export class ReviewStartError extends Error {}

/** Fetches what's logged at the place and starts reviewing it. Needs signal. */
export async function startReview(locationId: string): Promise<void> {
  await startReviewStore();
  set({ starting: true, saved: null });
  try {
    let response: Response;
    try {
      response = await fetch(`/api/reviews/${locationId}`, { redirect: "manual", cache: "no-store" });
    } catch {
      throw new ReviewStartError("Starting a review needs signal once, to get the list of books logged here. Try again where there's signal.");
    }
    if (response.type === "opaqueredirect") throw new ReviewStartError("Your login has expired. Reload the page to log in again.");
    const body = (await response.json().catch(() => null)) as (ReviewSnapshot & { error?: string }) | null;
    if (!response.ok || !body) throw new ReviewStartError(body?.error ?? "Couldn't start the review. Try again.");
    set({
      session: {
        locationId: body.locationId,
        placeName: body.placeName,
        startedAt: new Date().toISOString(),
        expected: body.expected,
        missingElsewhere: body.missingElsewhere,
        otherPlaces: body.otherPlaces,
        scans: [],
        ticked: [],
        decisions: {},
      },
      titles: {},
    });
    await persist();
  } finally {
    set({ starting: false });
  }
}

async function update(change: (session: ReviewSession) => ReviewSession) {
  await startReviewStore();
  if (!state.session) return;
  set({ session: change(state.session) });
  await persist();
}

export function reviewScan(key: string) {
  const scan = { id: crypto.randomUUID(), key, at: new Date().toISOString() };
  void fetchTitle(key);
  return update((s) => ({ ...s, scans: [...s.scans, scan] }));
}

export function undoReviewScan(scanId: string) {
  return update((s) => ({ ...s, scans: s.scans.filter((x) => x.id !== scanId) }));
}

export function answerReviewQuestion(scanId: string, value: "yes" | "no") {
  return update((s) => answer(s, scanId, value));
}

export function tickReviewCopy(copyId: string, here: boolean) {
  return update((s) => ({
    ...s,
    ticked: here ? [...new Set([...s.ticked, copyId])] : s.ticked.filter((id) => id !== copyId),
  }));
}

export function decideNotFound(copyIds: string[], decision: "remove" | "pending") {
  return update((s) => ({ ...s, decisions: { ...s.decisions, ...Object.fromEntries(copyIds.map((id) => [id, decision])) } }));
}

export async function cancelReview() {
  await startReviewStore();
  set({ session: null, titles: {} });
  await persist();
}

/** Saves the review: queued for upload, and the phone is free for the next one. */
export async function saveReview() {
  await startReviewStore();
  const session = state.session;
  if (!session) return;
  const payload = payloadOf(session, crypto.randomUUID(), new Date().toISOString());
  await queueReview(payload, session.placeName);
  const result = evaluate(session);
  set({
    session: null,
    titles: {},
    saved: {
      placeName: session.placeName,
      found: payload.found.length,
      added: payload.add.length,
      relocated: payload.relocate.length,
      removed: payload.remove.length,
      pending: result.notFound.length - payload.remove.length,
    },
  });
  await persist();
}

export function dismissSaved() {
  set({ saved: null });
}

/** A title for a scanned book that isn't in the review's list, if the server knows it. */
async function fetchTitle(key: string) {
  if (state.titles[key] || state.session?.expected.some((c) => c.key === key)) return;
  try {
    const response = await fetch(`/api/editions?keys=${encodeURIComponent(key)}`, { redirect: "manual", cache: "no-store" });
    if (!response.ok) return;
    const { editions } = (await response.json()) as { editions: { key: string; title: string | null }[] };
    const title = editions[0]?.title;
    if (title) set({ titles: { ...state.titles, [key]: title } });
  } catch {
    // No signal: the ISBN is shown instead.
  }
}

export function useReviewState(): ReviewState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
