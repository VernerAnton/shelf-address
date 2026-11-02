"use client";

/**
 * The phone's side of Saved texts (docs/spec-corrections.md §24): Extract's
 * text goes to the server so the computer can pick it up. Each version is
 * kept on the phone until the server has it, so no signal just means later.
 */

import { kvGet, kvSet } from "./kv";

export type OutgoingText = { id: string; text: string; source: "ai" | "phone"; createdAt: string; updatedAt: string };
export type SyncResult = "saved" | "waiting" | "loggedout";

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
 */
export function syncTexts(): Promise<SyncResult> {
  syncing ??= (async (): Promise<SyncResult> => {
    for (;;) {
      const box = (await kvGet<Record<string, OutgoingText>>(OUTBOX)) ?? {};
      const entry = Object.values(box)[0];
      if (!entry) return "saved";
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

if (typeof window !== "undefined") window.addEventListener("online", () => void syncTexts());
