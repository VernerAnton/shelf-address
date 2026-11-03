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

if (typeof window !== "undefined") window.addEventListener("online", () => void syncTexts());
