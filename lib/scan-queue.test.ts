import { describe, expect, it } from "vitest";
import {
  discard,
  enqueue,
  markFailed,
  markSent,
  nextToSend,
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
