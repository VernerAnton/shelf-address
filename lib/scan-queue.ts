/**
 * The offline queue's rules (docs/spec-corrections.md §8), as pure functions
 * over an array so they can be tested without a browser. The Scan screen keeps
 * the array in IndexedDB and replays it against the API, oldest first.
 *
 * Four things can be waiting to upload: a new copy, an undo, a condition
 * change, and a cover photo (§15 — the photo itself is kept on the phone under
 * its photoId, not in the queue). Where a later action cancels or updates one
 * still waiting, the two are merged on the phone and the network never sees
 * the first.
 */

/** Title/author/year for a book without an ISBN, sent with its first copy. */
export type EditionDetails = {
  title: string;
  author: string | null;
  year: number | null;
  publisher: string | null;
};

export type Op =
  | {
      kind: "create";
      copyId: string;
      /** The edition key: an ISBN-13, or finna:/manual: for a book without one. */
      isbn13: string;
      locationId: string;
      condition: string | null;
      scannedAt: string;
      edition?: EditionDetails;
    }
  | { kind: "delete"; copyId: string }
  | { kind: "condition"; copyId: string; condition: string | null }
  /** A cover photographed for the copy's edition — shared by every copy of it. */
  | { kind: "cover"; copyId: string; isbn13: string; photoId: string };

export type QueuedOp = Op & {
  /** "waiting" is retried automatically; "failed" needs the person to act. */
  state: "waiting" | "failed";
  error?: string;
};

export function enqueue(queue: QueuedOp[], op: Op): QueuedOp[] {
  const unsentCreate = queue.find((q) => q.kind === "create" && q.copyId === op.copyId);

  switch (op.kind) {
    case "cover":
      // A newer photo of the same book replaces one still waiting.
      return [
        ...queue.filter((q) => !(q.kind === "cover" && q.isbn13 === op.isbn13)),
        { ...op, state: "waiting" },
      ];

    case "create":
      return [...queue, { ...op, state: "waiting" }];

    case "delete":
      // Undoing a scan that never reached the server: forget it entirely.
      if (unsentCreate) return queue.filter((q) => q.copyId !== op.copyId);
      // Otherwise any queued condition change is moot; send just the delete.
      return [
        ...queue.filter((q) => !(q.copyId === op.copyId && q.kind === "condition")),
        { ...op, state: "waiting" },
      ];

    case "condition": {
      if (unsentCreate) {
        return queue.map((q) =>
          q === unsentCreate ? { ...q, condition: op.condition } : q,
        );
      }
      const queued = queue.find((q) => q.kind === "condition" && q.copyId === op.copyId);
      if (queued) {
        return queue.map((q) =>
          q === queued ? { ...q, condition: op.condition, state: "waiting", error: undefined } : q,
        );
      }
      return [...queue, { ...op, state: "waiting" }];
    }
  }
}

/** The oldest op still due to be sent. */
export function nextToSend(queue: QueuedOp[]): QueuedOp | undefined {
  return queue.find((q) => q.state === "waiting");
}

/** Drop `sent` after the server accepted it. */
export function markSent(queue: QueuedOp[], sent: QueuedOp): QueuedOp[] {
  return queue.filter((q) => q !== sent);
}

/** Park `op` with the server's reason; it stops being retried. */
export function markFailed(queue: QueuedOp[], op: QueuedOp, error: string): QueuedOp[] {
  return queue.map((q) => (q === op ? { ...q, state: "failed", error } : q));
}

/** A failed scan, re-aimed at another place (e.g. the original was deleted). */
export function retryCreateAt(queue: QueuedOp[], copyId: string, locationId: string): QueuedOp[] {
  return queue.map((q) =>
    q.kind === "create" && q.copyId === copyId
      ? { ...q, locationId, state: "waiting", error: undefined }
      : q,
  );
}

/** Give up on everything queued for one copy. */
export function discard(queue: QueuedOp[], copyId: string): QueuedOp[] {
  return queue.filter((q) => q.copyId !== copyId);
}

export type CopyStatus = "saved" | "waiting" | "failed";

/** How a scan should be labelled on the Scan screen. */
export function statusOf(queue: QueuedOp[], copyId: string): { status: CopyStatus; error?: string } {
  // A cover photo has its own status (coverUploadOf): a failed photo mustn't
  // read as a copy that wasn't saved.
  const ops = queue.filter((q) => q.copyId === copyId && q.kind !== "cover");
  const failed = ops.find((q) => q.state === "failed");
  if (failed) return { status: "failed", error: failed.error };
  if (ops.length > 0) return { status: "waiting" };
  return { status: "saved" };
}

/** The cover photo waiting (or failed) for an edition, if any. */
export function coverUploadOf(queue: QueuedOp[], isbn13: string): Extract<QueuedOp, { kind: "cover" }> | undefined {
  return queue.find((q): q is Extract<QueuedOp, { kind: "cover" }> => q.kind === "cover" && q.isbn13 === isbn13);
}

/** Give up on a cover photo that couldn't be saved. */
export function discardCover(queue: QueuedOp[], isbn13: string): QueuedOp[] {
  return queue.filter((q) => !(q.kind === "cover" && q.isbn13 === isbn13));
}

/** Photos the queue still needs; any other stored photo can be deleted. */
export function photoIdsIn(queue: QueuedOp[]): Set<string> {
  return new Set(queue.flatMap((q) => (q.kind === "cover" ? [q.photoId] : [])));
}
