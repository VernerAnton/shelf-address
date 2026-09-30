import { describe, expect, it } from "vitest";
import {
  answer,
  evaluate,
  missingCopyFor,
  payloadOf,
  type ExpectedCopy,
  type MissingCopy,
  type ReviewSession,
} from "@/lib/review";

const SINUHE = "9789510366868";
const LEINO = "9789510000017";
const KALEVALA = "9789510000024";

const copy = (copyId: string, key: string, extra: Partial<ExpectedCopy> = {}): ExpectedCopy => ({
  copyId,
  key,
  title: null,
  author: null,
  coverUrl: null,
  scannable: true,
  missingSince: null,
  ...extra,
});
const missing = (copyId: string, key: string, placeName: string): MissingCopy => ({
  copyId,
  key,
  placeId: placeName.toLowerCase().replace(/\s/g, "-"),
  placeName,
  missingSince: "2026-09-20T10:00:00Z",
});

let n = 0;
function session(expected: ExpectedCopy[], missingElsewhere: MissingCopy[] = []): ReviewSession {
  return {
    locationId: "row-1",
    placeName: "Row 1",
    startedAt: "2026-09-30T10:00:00Z",
    expected,
    missingElsewhere,
    otherPlaces: {},
    scans: [],
    ticked: [],
    decisions: {},
  };
}
function scan(s: ReviewSession, ...keys: string[]): ReviewSession {
  return { ...s, scans: [...s.scans, ...keys.map((key) => ({ id: `scan-${++n}`, key, at: "2026-09-30T10:05:00Z" }))] };
}

describe("review: each scan", () => {
  it("ticks off a copy logged here, never duplicating it", () => {
    const s = scan(session([copy("c1", SINUHE)]), SINUHE);
    const r = evaluate(s);
    expect(r.found.map((c) => c.copyId)).toEqual(["c1"]);
    expect(r.added).toEqual([]);
    expect(r.notFound).toEqual([]);
  });

  it("adds a book that's new to the system", () => {
    const r = evaluate(scan(session([copy("c1", SINUHE)]), SINUHE, LEINO));
    expect(r.added.map((s) => s.key)).toEqual([LEINO]);
  });

  it("counts copies: two logged, three scanned is two ticked and one added", () => {
    const s = scan(session([copy("c1", SINUHE), copy("c2", SINUHE)]), SINUHE, SINUHE, SINUHE);
    const r = evaluate(s);
    expect(r.found.map((c) => c.copyId).sort()).toEqual(["c1", "c2"]);
    expect(r.added).toHaveLength(1);
  });

  it("adds another copy of a book logged elsewhere without asking, when nothing is missing", () => {
    // Copies of Sinuhe exist in other rows, but none is missing: just add it.
    const r = evaluate(scan(session([]), SINUHE));
    expect(r.added).toHaveLength(1);
    expect(r.unanswered).toBe(0);
  });

  it("asks about a copy missing from elsewhere; yes changes its address, no adds a new copy", () => {
    const base = scan(session([], [missing("m1", SINUHE, "Row 3")]), SINUHE);
    const asked = evaluate(base);
    const scanId = base.scans[0].id;
    expect(asked.outcomes.get(scanId)).toMatchObject({ kind: "ask", claim: { copyId: "m1", placeName: "Row 3" } });
    expect(asked.unanswered).toBe(1);

    const yes = evaluate(answer(base, scanId, "yes"));
    expect(yes.relocated.map((m) => m.copyId)).toEqual(["m1"]);
    expect(yes.added).toEqual([]);

    const no = evaluate(answer(base, scanId, "no"));
    expect(no.relocated).toEqual([]);
    expect(no.added).toHaveLength(1);
  });
});

describe("review: the book in Row 1 and Row 3", () => {
  // Logged once in Row 1 and once in Row 3. Row 1's review doesn't find it.
  it("reviewing Row 1: it's not found and left pending", () => {
    const row1 = session([copy("in-row-1", SINUHE)]);
    const r = evaluate(row1);
    expect(r.notFound.map((c) => c.copyId)).toEqual(["in-row-1"]);
    expect(payloadOf(row1, "r1", "2026-09-30T11:00:00Z").pending).toEqual(["in-row-1"]);
  });

  it("reviewing Row 3: its own copy is ticked, no question", () => {
    const row3 = { ...session([copy("in-row-3", SINUHE)], [missing("in-row-1", SINUHE, "Row 1")]), locationId: "row-3" };
    const r = evaluate(scan(row3, SINUHE));
    expect(r.found.map((c) => c.copyId)).toEqual(["in-row-3"]);
    expect(r.unanswered).toBe(0);
  });

  it("reviewing Row 3: a second copy there is asked about — is it Row 1's?", () => {
    const row3 = { ...session([copy("in-row-3", SINUHE)], [missing("in-row-1", SINUHE, "Row 1")]), locationId: "row-3" };
    const s = scan(row3, SINUHE, SINUHE);
    const r = evaluate(s);
    expect(r.outcomes.get(s.scans[1].id)).toMatchObject({ kind: "ask", claim: { copyId: "in-row-1" } });
    const saved = payloadOf(answer(s, s.scans[1].id, "yes"), "r3", "2026-09-30T11:00:00Z");
    expect(saved.found).toEqual(["in-row-3"]);
    expect(saved.relocate).toEqual(["in-row-1"]);
    expect(saved.add).toEqual([]);
  });
});

describe("review: finishing", () => {
  it("won't save while a question is unanswered", () => {
    const s = scan(session([], [missing("m1", SINUHE, "Row 3")]), SINUHE);
    expect(() => payloadOf(s, "r", "t")).toThrow();
  });

  it("a second extra copy while the first is unanswered is asked about the next missing copy, else added", () => {
    const s = scan(session([], [missing("m1", SINUHE, "Row 3"), missing("m2", SINUHE, "Row 5")]), SINUHE, SINUHE, SINUHE);
    const r = evaluate(s);
    expect([...r.outcomes.values()].map((o) => ("claim" in o ? o.claim.copyId : o.kind))).toEqual(["m1", "m2", "new"]);
  });

  it("books without a barcode are ticked by hand", () => {
    const s = { ...session([copy("b1", "manual:abc", { scannable: false }), copy("b2", "finna:x", { scannable: false })]), ticked: ["b1"] };
    const r = evaluate(s);
    expect(r.found.map((c) => c.copyId)).toEqual(["b1"]);
    expect(r.notFound.map((c) => c.copyId)).toEqual(["b2"]);
  });

  it("not-found copies are pending unless removed; found ones clear any old mark", () => {
    const s = {
      ...scan(session([copy("c1", SINUHE, { missingSince: "2026-09-01T00:00:00Z" }), copy("c2", LEINO), copy("c3", KALEVALA)]), SINUHE, "9780140328721"),
      decisions: { c2: "remove" as const },
    };
    const p = payloadOf(s, "review-1", "2026-09-30T11:00:00Z");
    expect(p).toMatchObject({ reviewId: "review-1", locationId: "row-1", found: ["c1"], remove: ["c2"], pending: ["c3"], relocate: [] });
    expect(p.add.map((a) => a.key)).toEqual(["9780140328721"]);
    expect(p.add[0].copyId).toBe(s.scans[1].id);
  });

  it("undoing a scan puts things back", () => {
    const s = scan(session([copy("c1", SINUHE)]), SINUHE);
    const undone = { ...s, scans: [] };
    expect(evaluate(undone).notFound.map((c) => c.copyId)).toEqual(["c1"]);
  });
});

describe("normal scanning: is this a missing copy?", () => {
  it("finds a missing copy of the book not already claimed", () => {
    const list = [missing("m1", SINUHE, "Row 3"), missing("m2", SINUHE, "Row 4")];
    expect(missingCopyFor(list, SINUHE, new Set())?.copyId).toBe("m1");
    expect(missingCopyFor(list, SINUHE, new Set(["m1"]))?.copyId).toBe("m2");
    expect(missingCopyFor(list, LEINO, new Set())).toBeNull();
  });
});
