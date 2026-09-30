/**
 * Review mode's rules (docs/spec-corrections.md §16), as pure functions so
 * they can be tested without a browser or database.
 *
 * A review works on changes since the place was last logged: it compares, book
 * by book, how many copies are logged at the place with how many are scanned
 * there now.
 *
 *   1. A scan of a book with an unticked copy logged here ticks that copy off.
 *   2. A scan beyond the copies logged here (a new book, or one more copy) is
 *      added here — unless that book has a copy marked missing from another
 *      place, when the person is asked "is this the copy missing from Row 3?"
 *      (yes: its address changes to here; no: added as a new copy).
 *   3. Copies logged here and not scanned are missing: removed (sold) or left
 *      pending, marked missing, so they're recognised if they turn up.
 *
 * Books without a barcode can't be scanned; they're ticked off by hand.
 */

export type ExpectedCopy = {
  copyId: string;
  key: string;
  title: string | null;
  author: string | null;
  coverUrl: string | null;
  /** Has an ISBN, so it can be scanned; otherwise it's ticked off by hand. */
  scannable: boolean;
  /** Already marked missing by an earlier review of this place. */
  missingSince: string | null;
};

/** A copy marked missing from some other place: a candidate for an extra scan here. */
export type MissingCopy = {
  copyId: string;
  key: string;
  placeId: string;
  placeName: string;
  missingSince: string;
};

/** Where else copies of a book are logged, shown for information. */
export type OtherPlace = { placeName: string; count: number; missing: number };

export type ReviewScan = {
  /** Also the new copy's id if this scan ends up adding one. */
  id: string;
  key: string;
  at: string;
  /** The answer to "is this the copy missing from …?", once given. */
  answer?: "yes" | "no";
  /** Which missing copy the answer was about (kept stable across undo). */
  claimCopyId?: string;
};

export type ReviewSession = {
  locationId: string;
  placeName: string;
  startedAt: string;
  expected: ExpectedCopy[];
  missingElsewhere: MissingCopy[];
  otherPlaces: Record<string, OtherPlace[]>;
  scans: ReviewScan[];
  /** Barcode-less copies ticked off by hand. */
  ticked: string[];
  /** For copies not found: remove them (sold) or leave them pending. Pending if unset. */
  decisions: Record<string, "remove" | "pending">;
};

export type ScanOutcome =
  | { kind: "found"; copy: ExpectedCopy }
  | { kind: "new" }
  | { kind: "ask"; claim: MissingCopy }
  | { kind: "relocated"; claim: MissingCopy }
  | { kind: "declined"; claim: MissingCopy };

export type ReviewResult = {
  outcomes: Map<string, ScanOutcome>;
  found: ExpectedCopy[];
  notFound: ExpectedCopy[];
  added: ReviewScan[];
  relocated: MissingCopy[];
  unanswered: number;
};

/** Works out what every scan so far means. Order matters: earlier scans claim copies first. */
export function evaluate(session: ReviewSession): ReviewResult {
  const unmatched = session.expected.filter((c) => c.scannable);
  const claimed = new Set<string>();
  const outcomes = new Map<string, ScanOutcome>();
  const found: ExpectedCopy[] = [];
  const added: ReviewScan[] = [];
  const relocated: MissingCopy[] = [];
  let unanswered = 0;

  for (const scan of session.scans) {
    const index = unmatched.findIndex((c) => c.key === scan.key);
    if (index >= 0) {
      const [copy] = unmatched.splice(index, 1);
      found.push(copy);
      outcomes.set(scan.id, { kind: "found", copy });
      continue;
    }
    // One more copy than is logged here. Is it one that went missing elsewhere?
    const claim =
      (scan.claimCopyId && session.missingElsewhere.find((m) => m.copyId === scan.claimCopyId && !claimed.has(m.copyId))) ||
      session.missingElsewhere.find((m) => m.key === scan.key && !claimed.has(m.copyId));
    if (!claim) {
      outcomes.set(scan.id, { kind: "new" });
      added.push(scan);
    } else if (scan.answer === "no") {
      outcomes.set(scan.id, { kind: "declined", claim });
      added.push(scan);
    } else {
      claimed.add(claim.copyId);
      if (scan.answer === "yes") {
        outcomes.set(scan.id, { kind: "relocated", claim });
        relocated.push(claim);
      } else {
        outcomes.set(scan.id, { kind: "ask", claim });
        unanswered++;
      }
    }
  }

  const ticked = new Set(session.ticked);
  for (const copy of session.expected) {
    if (!copy.scannable && ticked.has(copy.copyId)) found.push(copy);
  }
  const foundIds = new Set(found.map((c) => c.copyId));
  const notFound = session.expected.filter((c) => !foundIds.has(c.copyId));
  return { outcomes, found, notFound, added, relocated, unanswered };
}

/** Records the answer to "is this the copy missing from …?" for one scan. */
export function answer(session: ReviewSession, scanId: string, value: "yes" | "no"): ReviewSession {
  const outcome = evaluate(session).outcomes.get(scanId);
  const claimCopyId = outcome && "claim" in outcome ? outcome.claim.copyId : undefined;
  return {
    ...session,
    scans: session.scans.map((s) => (s.id === scanId ? { ...s, answer: value, claimCopyId } : s)),
  };
}

/** What gets sent to the server when the review is saved. */
export type ReviewPayload = {
  reviewId: string;
  locationId: string;
  finishedAt: string;
  /** Logged here and seen: any "missing" mark is cleared. */
  found: string[];
  /** New copies logged here. */
  add: { copyId: string; key: string; scannedAt: string }[];
  /** Copies missing from elsewhere whose address changes to here. */
  relocate: string[];
  /** Not found and removed as sold. */
  remove: string[];
  /** Not found, left pending: marked missing. */
  pending: string[];
};

export function payloadOf(session: ReviewSession, reviewId: string, finishedAt: string): ReviewPayload {
  const result = evaluate(session);
  if (result.unanswered > 0) throw new Error("Answer every question before saving.");
  return {
    reviewId,
    locationId: session.locationId,
    finishedAt,
    found: result.found.map((c) => c.copyId),
    add: result.added.map((s) => ({ copyId: s.id, key: s.key, scannedAt: s.at })),
    relocate: result.relocated.map((m) => m.copyId),
    remove: result.notFound.filter((c) => session.decisions[c.copyId] === "remove").map((c) => c.copyId),
    pending: result.notFound.filter((c) => session.decisions[c.copyId] !== "remove").map((c) => c.copyId),
  };
}

/**
 * Outside a review: a book scanned into a place may be a copy that went
 * missing from somewhere else. The first such copy not already claimed, if any.
 */
export function missingCopyFor(missing: MissingCopy[], key: string, claimed: Set<string>): MissingCopy | null {
  return missing.find((m) => m.key === key && !claimed.has(m.copyId)) ?? null;
}
