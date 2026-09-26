import { describe, expect, it } from "vitest";
import {
  coverUploadOf,
  discard,
  discardCover,
  enqueue,
  markFailed,
  markSent,
  nextToSend,
  photoIdsIn,
  retryCreateAt,
  statusOf,
  type Op,
  type QueuedOp,
} from "@/lib/scan-queue";

const create = (copyId: string, extra: Partial<Extract<Op, { kind: "create" }>> = {}): Op => ({
  kind: "create",
  copyId,
  isbn13: "9789510366868",
  locationId: "row",
  condition: null,
  scannedAt: "2026-09-25T08:00:00Z",
  ...extra,
});

const run = (...ops: Op[]) => ops.reduce<QueuedOp[]>(enqueue, []);

describe("enqueue", () => {
  it("queues scans in order", () => {
    const q = run(create("a"), create("b"));
    expect(q.map((o) => o.copyId)).toEqual(["a", "b"]);
    expect(nextToSend(q)?.copyId).toBe("a");
  });

  it("undoing an unsent scan removes it without any upload", () => {
    const q = run(create("a"), { kind: "condition", copyId: "a", condition: "torn" }, { kind: "delete", copyId: "a" });
    expect(q).toEqual([]);
  });

  it("undoing an uploaded scan queues a delete and drops a pending condition change", () => {
    const q = run({ kind: "condition", copyId: "a", condition: "torn" }, { kind: "delete", copyId: "a" });
    expect(q.map((o) => o.kind)).toEqual(["delete"]);
  });

  it("a condition on an unsent scan rides along with the scan itself", () => {
    const q = run(create("a"), { kind: "condition", copyId: "a", condition: "torn" });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "create", condition: "torn" });
  });

  it("repeated condition edits collapse to the latest", () => {
    const q = run(
      { kind: "condition", copyId: "a", condition: "torn" },
      { kind: "condition", copyId: "a", condition: "water damage" },
    );
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ condition: "water damage" });
  });
});

describe("sending", () => {
  it("removes what was sent and moves on", () => {
    let q = run(create("a"), create("b"));
    q = markSent(q, nextToSend(q)!);
    expect(nextToSend(q)?.copyId).toBe("b");
  });

  it("parks a permanent failure and carries on with the rest", () => {
    let q = run(create("a"), create("b"));
    q = markFailed(q, nextToSend(q)!, "That place no longer exists");
    expect(nextToSend(q)?.copyId).toBe("b");
    expect(statusOf(q, "a")).toEqual({ status: "failed", error: "That place no longer exists" });
  });

  it("a failed scan can be re-aimed at another place and retried", () => {
    let q = run(create("a"));
    q = markFailed(q, q[0], "gone");
    q = retryCreateAt(q, "a", "other");
    expect(nextToSend(q)).toMatchObject({ copyId: "a", locationId: "other", state: "waiting" });
  });

  it("a failed scan can be discarded", () => {
    let q = run(create("a"), create("b"));
    q = markFailed(q, q[0], "gone");
    expect(discard(q, "a").map((o) => o.copyId)).toEqual(["b"]);
  });
});

describe("statusOf", () => {
  it("reads waiting, failed and saved", () => {
    const q = run(create("a"));
    expect(statusOf(q, "a").status).toBe("waiting");
    expect(statusOf([], "a").status).toBe("saved");
  });
});

describe("cover photos", () => {
  const cover = (copyId: string, photoId: string, isbn13 = "9789510366868"): Op => ({ kind: "cover", copyId, isbn13, photoId });

  it("upload after the scan they belong to", () => {
    const q = run(create("a"), cover("a", "p1"));
    expect(nextToSend(q)?.kind).toBe("create");
    expect(nextToSend(markSent(q, q[0]))?.kind).toBe("cover");
  });

  it("a newer photo of the same book replaces one still waiting", () => {
    const q = run(create("a"), cover("a", "p1"), create("b"), cover("b", "p2"));
    expect(q.filter((o) => o.kind === "cover")).toHaveLength(1);
    expect(coverUploadOf(q, "9789510366868")?.photoId).toBe("p2");
    expect([...photoIdsIn(q)]).toEqual(["p2"]);
  });

  it("photos of different books are kept apart", () => {
    const q = run(cover("a", "p1"), cover("b", "p2", "9780140328721"));
    expect([...photoIdsIn(q)].sort()).toEqual(["p1", "p2"]);
  });

  it("undoing an unsent scan drops its photo too", () => {
    const q = run(create("a"), cover("a", "p1"), { kind: "delete", copyId: "a" });
    expect(q).toEqual([]);
  });

  it("a failed photo doesn't make the scan read as unsaved, and can be dropped", () => {
    let q = run(cover("a", "p1"));
    q = markFailed(q, q[0], "This book isn't logged any more.");
    expect(statusOf(q, "a").status).toBe("saved");
    expect(coverUploadOf(q, "9789510366868")?.state).toBe("failed");
    expect(discardCover(q, "9789510366868")).toEqual([]);
  });
});
