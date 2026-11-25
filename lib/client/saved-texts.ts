"use client";

/**
 * The phone's side of Saved texts (docs/spec-corrections.md §24): Extract's
 * text goes to the server so the computer can pick it up. Each version is
 * kept on the phone until the server has it, so no signal just means later.
 */

import { kvGet, kvSet } from "./kv";

export type OutgoingText = { id: string; text: string; source: "ai" | "phone"; createdAt: string; updatedAt: string };
export type SyncResult = "saved" | "waiting" | "loggedout" | "editedOnComputer";

const OUTBOX = "extract:outbox";

export async function queueText(entry: OutgoingText) {
  const box = (await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {};
  box[entry.id] = entry;
  await kvSet(OUTBOX, box);
}

let syncing: Promise<SyncResult> | null = null;

/**
 * Sends whatever is waiting, including versions queued while it runs.
 * "waiting": no signal (or the server had trouble) — tried again later.
 * "loggedout": the server wants the access code again.
 * "editedOnComputer": a text was corrected on the computer since; the
 * phone's version isn't kept (the computer's wins).
 */
export function syncTexts(): Promise<SyncResult> {
  syncing ??= (async (): Promise<SyncResult> => {
    let outcome: SyncResult = "saved";
    for (;;) {
      const box = (await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {};
      const entry = Object.values(box)[0];
      if (!entry) return outcome;
      let response: Response;
      try {
        response = await fetch(`/api/extract/texts/${entry.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(entry),
        });
      } catch {
        return "waiting";
      }
      if (response.status === 401) return "loggedout";
      if (response.status >= 500) return "waiting";
      const body = (await response.json().catch(() => null)) as { result?: string } | null;
      if (body?.result === "editedOnComputer") outcome = "editedOnComputer";
      // Saved (or refused for good: nothing to gain by sending it again). A newer
      // version queued meanwhile stays, and goes next.
      const now = (await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {};
      if (now[entry.id]?.updatedAt === entry.updatedAt) {
        delete now[entry.id];
        await kvSet(OUTBOX, now);
      }
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/**
 * Front covers (§28) waiting to go up, one per text (a newer photo replaces a
 * waiting one). They go after the texts, as the server needs the text first.
 */
const COVERS = "extract:covers";
type OutgoingCover = { id: string; photo: Blob; takenAt: string };
export type CoverResult = "saved" | "waiting" | "loggedout";

export async function queueCover(id: string, photo: Blob) {
  const box = (await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {};
  box[id] = { id, photo, takenAt: new Date().toISOString() };
  await kvSet(COVERS, box);
}

let sendingCovers: Promise<CoverResult> | null = null;

/** Sends the waiting front covers (after any waiting texts). */
export function syncCovers(): Promise<CoverResult> {
  sendingCovers ??= (async (): Promise<CoverResult> => {
    const texts = await syncTexts();
    if (texts === "loggedout") return "loggedout";
    for (;;) {
      const box = (await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {};
      const entry = Object.values(box)[0];
      if (!entry) return "saved";
      let response: Response;
      try {
        response = await fetch(`/api/extract/texts/${entry.id}/cover`, {
          method: "PUT",
          headers: { "content-type": entry.photo.type || "image/jpeg" },
          body: entry.photo,
        });
      } catch {
        return "waiting";
      }
      if (response.status === 401) return "loggedout";
      if (response.status >= 500) return "waiting";
      // The text isn't up yet (it's still waiting itself): keep the cover for later.
      if (response.status === 404 && ((await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {})[entry.id]) return "waiting";
      // Saved, or refused for good (the text was deleted on the computer, say).
      const now = (await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {};
      if (now[entry.id]?.takenAt === entry.takenAt) {
        delete now[entry.id];
        await kvSet(COVERS, now);
      }
    }
  })().finally(() => {
    sendingCovers = null;
  });
  return sendingCovers;
}

if (typeof window !== "undefined") window.addEventListener("online", () => void syncCovers());
