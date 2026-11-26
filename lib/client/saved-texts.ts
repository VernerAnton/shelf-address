"use client";

/**
 * The phone's side of Saved texts (docs/spec-corrections.md §24): Extract's
 * text goes to the server so the computer can pick it up. Each version is
 * kept on the phone until the server has it, so no signal just means later.
 */

import { kvGet, kvSet } from "./kv";

export type OutgoingText = {
  id: string;
  text: string;
  source: "ai" | "phone";
  createdAt: string;
  updatedAt: string;
  /** The book's ISBN-13 and where it came from (V34). */
  isbn?: string | null;
  isbnSource?: "barcode" | "ai" | "typed" | null;
  /** A second ISBN, for books that print two (V34.5). */
  isbn2?: string | null;
};
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

let sendingCovers: Promise<Record<string, CoverResult>> | null = null;

/**
 * Sends the waiting front covers (after any waiting texts). Resolves to how
 * it went for the text `id` (the one on screen): "saved" once its cover is up
 * (or none is waiting for it), "waiting" if it's still on the phone.
 */
export async function syncCovers(id?: string): Promise<CoverResult> {
  sendingCovers ??= (async (): Promise<Record<string, CoverResult>> => {
    const outcome: Record<string, CoverResult> = {};
    const texts = await syncTexts();
    const tried = new Set<string>();
    for (;;) {
      const box = (await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {};
      const entry = Object.values(box).find((e) => !tried.has(`${e.id}@${e.takenAt}`));
      if (!entry) return outcome;
      tried.add(`${entry.id}@${entry.takenAt}`);
      if (texts === "loggedout") {
        outcome[entry.id] = "loggedout";
        continue;
      }
      let response: Response;
      try {
        response = await fetch(`/api/extract/texts/${entry.id}/cover`, {
          method: "PUT",
          headers: { "content-type": entry.photo.type || "image/jpeg" },
          body: entry.photo,
        });
      } catch {
        // No signal: everything still waiting stays for later.
        for (const e of Object.values(box)) outcome[e.id] ??= "waiting";
        return outcome;
      }
      if (response.status === 401) {
        outcome[entry.id] = "loggedout";
        continue;
      }
      if (response.status >= 500) {
        outcome[entry.id] = "waiting";
        continue;
      }
      // The text isn't up yet (still waiting itself, or still being read: V30): keep the cover
      // for later, and go on with the others. One whose text never turns up within the hour is let go.
      if (response.status === 404) {
        const textWaiting = ((await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {})[entry.id];
        if (textWaiting || Date.now() - Date.parse(entry.takenAt) < 3600_000) {
          outcome[entry.id] = "waiting";
          continue;
        }
      }
      // Saved, or refused for good (the text was deleted on the computer, say).
      outcome[entry.id] = "saved";
      const now = (await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {};
      if (now[entry.id]?.takenAt === entry.takenAt) {
        delete now[entry.id];
        await kvSet(COVERS, now);
      }
    }
  })().finally(() => {
    sendingCovers = null;
  });
  const outcome = await sendingCovers;
  if (id && !outcome[id] && ((await kvGet<Record<string, OutgoingCover>>(COVERS)) ?? {})[id]) {
    // Queued just as a run was finishing: one more go for it.
    return syncCovers(id);
  }
  return (id && outcome[id]) || "saved";
}

if (typeof window !== "undefined") window.addEventListener("online", () => void syncCovers());
