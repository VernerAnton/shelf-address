"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CheckIcon, PlusIcon, WarningIcon } from "@/components/icons";
import {
  answerReviewQuestion,
  cancelReview,
  decideNotFound,
  saveReview,
  tickReviewCopy,
  undoReviewScan,
} from "@/lib/client/review-store";
import { keyLabel } from "@/lib/edition-key";
import { evaluate, type ExpectedCopy, type ReviewScan, type ReviewSession, type ScanOutcome } from "@/lib/review";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function titleOf(session: ReviewSession, titles: Record<string, string>, key: string) {
  return session.expected.find((c) => c.key === key)?.title ?? titles[key] ?? null;
}

function BookLine({ title, bookKey, cover }: { title: string | null; bookKey: string; cover?: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {cover !== undefined && <BookCover src={cover} />}
      <span className="min-w-0 flex-1">
        {title ? (
          <>
            <span className="line-clamp-2 font-medium leading-snug">{title}</span>
            <span className="block truncate font-mono text-xs text-muted">{keyLabel(bookKey)}</span>
          </>
        ) : (
          <span className="block font-mono font-medium">{keyLabel(bookKey)}</span>
        )}
      </span>
    </span>
  );
}

/** The "is this the copy missing from …?" question, with its two answers. */
function Question({ scan, outcome, title }: { scan: ReviewScan; outcome: Extract<ScanOutcome, { kind: "ask" }>; title: string | null }) {
  return (
    <li className="flex flex-col gap-2 border-b border-warn-line px-4 py-3 last:border-0">
      <BookLine title={title} bookKey={scan.key} />
      <p className="text-sm">
        A copy of this book is <strong>missing from {outcome.claim.placeName}</strong> (not found on{" "}
        {day(outcome.claim.missingSince)}). Is this that copy?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void answerReviewQuestion(scan.id, "yes")}
          className="h-10 flex-1 rounded-lg bg-accent px-3 text-sm font-medium text-accent-contrast"
        >
          Yes — change its address to here
        </button>
        <button
          type="button"
          onClick={() => void answerReviewQuestion(scan.id, "no")}
          className="h-10 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
        >
          No, another copy
        </button>
      </div>
    </li>
  );
}

function Questions({ session, titles }: { session: ReviewSession; titles: Record<string, string> }) {
  const { outcomes } = evaluate(session);
  const asks = session.scans.flatMap((scan) => {
    const outcome = outcomes.get(scan.id);
    return outcome?.kind === "ask" ? [{ scan, outcome }] : [];
  });
  if (asks.length === 0) return null;
  return (
    <section aria-label="Questions" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-warn-text">
        {asks.length === 1 ? "1 question" : `${asks.length} questions`}
      </h2>
      <ul className="overflow-hidden rounded-xl border border-warn-line bg-warn-bg">
        {asks.map(({ scan, outcome }) => (
          <Question key={scan.id} scan={scan} outcome={outcome} title={titleOf(session, titles, scan.key)} />
        ))}
      </ul>
    </section>
  );
}

const OUTCOME_LABEL: Record<ScanOutcome["kind"], string> = {
  found: "Was here",
  new: "Added here",
  ask: "Question above",
  relocated: "Address changed to here",
  declined: "Added here as another copy",
};

/** What a review scan came to, in one short line for the camera area. */
export function lastScanLine(session: ReviewSession, titles: Record<string, string>): string | null {
  const scan = session.scans.at(-1);
  if (!scan) return null;
  const outcome = evaluate(session).outcomes.get(scan.id);
  const name = titleOf(session, titles, scan.key) ?? keyLabel(scan.key);
  if (!outcome) return null;
  if (outcome.kind === "found") return `✓ ${name} — was here`;
  if (outcome.kind === "ask") return `? ${name} — may be the copy missing from ${outcome.claim.placeName}`;
  if (outcome.kind === "relocated") return `✓ ${name} — address changed to here`;
  return `+ ${name} — added here`;
}

/** Header card for the review in progress: where, how far, finish or stop. */
export function ReviewHeader({ session, onFinish }: { session: ReviewSession; onFinish: () => void }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { found, added, relocated } = evaluate(session);
  return (
    <section aria-label="Review in progress" className="flex flex-col gap-3 rounded-xl border-2 border-accent bg-surface p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Reviewing</p>
        <p className="text-lg font-semibold">{session.placeName}</p>
        <p role="status" className="text-sm text-muted">
          {found.length} of {session.expected.length} found
          {added.length > 0 && ` · ${added.length} added`}
          {relocated.length > 0 && ` · ${relocated.length} address ${relocated.length === 1 ? "change" : "changes"}`}
        </p>
      </div>
      {confirmCancel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Stop without saving? Nothing from this review will be kept.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmCancel(false)} className="h-11 flex-1 rounded-xl border border-line font-medium">
              Keep reviewing
            </button>
            <button type="button" onClick={() => void cancelReview()} className="h-11 flex-1 rounded-xl bg-danger font-medium text-white">
              Stop review
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmCancel(true)} className="h-11 rounded-xl border border-line px-4 font-medium">
            Cancel
          </button>
          <button type="button" onClick={onFinish} className="h-11 flex-1 rounded-xl bg-accent font-medium text-accent-contrast">
            Finish review
          </button>
        </div>
      )}
    </section>
  );
}

/** Below the scanner during a review: questions, hand-ticks, scanned and still-missing books. */
export function ReviewLists({ session, titles }: { session: ReviewSession; titles: Record<string, string> }) {
  const { outcomes, found, notFound } = evaluate(session);
  const foundIds = new Set(found.map((c) => c.copyId));
  const handTick = session.expected.filter((c) => !c.scannable);
  const stillMissing = notFound.filter((c) => c.scannable);

  return (
    <>
      <Questions session={session} titles={titles} />

      {handTick.length > 0 && (
        <section aria-label="Books without a barcode" className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">No barcode — tick the ones you can see</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {handTick.map((c) => (
              <li key={c.copyId} className="border-b border-line last:border-0">
                <label className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={foundIds.has(c.copyId)}
                    onChange={(e) => void tickReviewCopy(c.copyId, e.target.checked)}
                    className="size-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <BookLine title={c.title} bookKey={c.key} />
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {session.scans.length > 0 && (
        <section aria-label="Scanned in this review" className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Scanned ({session.scans.length})</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {[...session.scans].reverse().map((scan) => {
              const outcome = outcomes.get(scan.id);
              const expected = outcome?.kind === "found" ? outcome.copy : undefined;
              return (
                <li key={scan.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className={outcome?.kind === "found" || outcome?.kind === "relocated" ? "text-emerald-600" : outcome?.kind === "ask" ? "text-warn-text" : "text-accent"}>
                    {outcome?.kind === "found" || outcome?.kind === "relocated" ? <CheckIcon className="size-5" /> : outcome?.kind === "ask" ? <WarningIcon className="size-5" /> : <PlusIcon className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <BookLine title={expected?.title ?? titleOf(session, titles, scan.key)} bookKey={scan.key} />
                    <span className="block text-xs text-muted">{outcome ? OUTCOME_LABEL[outcome.kind] : ""}</span>
                  </span>
                  <button type="button" onClick={() => void undoReviewScan(scan.id)} className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-medium">
                    Undo
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {stillMissing.length > 0 && (
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm font-medium">
            Not scanned yet ({stillMissing.length})
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
            {stillMissing.map((c) => (
              <li key={c.copyId} className="border-b border-line px-4 py-2.5 last:border-0">
                <BookLine title={c.title} bookKey={c.key} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function NotFoundRow({ copy, session }: { copy: ExpectedCopy; session: ReviewSession }) {
  const decision = session.decisions[copy.copyId] ?? "pending";
  const others = session.otherPlaces[copy.key] ?? [];
  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-0">
      <BookLine title={copy.title} bookKey={copy.key} cover={copy.coverUrl} />
      <p className="text-sm text-muted">
        {others.length > 0
          ? `Other copies: ${others.map((o) => `${o.placeName}${o.count > 1 ? ` (${o.count})` : ""}${o.missing > 0 ? " — also missing" : ""}`).join("; ")}`
          : "No other copies logged."}
        {copy.missingSince && ` Also not found on ${day(copy.missingSince)}.`}
      </p>
      <div role="radiogroup" aria-label={`What to do with ${copy.title ?? keyLabel(copy.key)}`} className="flex gap-2">
        {(["pending", "remove"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={decision === value}
            onClick={() => void decideNotFound([copy.copyId], value)}
            className={`h-10 flex-1 rounded-lg border px-3 text-sm font-medium ${
              decision === value
                ? value === "remove"
                  ? "border-danger bg-danger text-white"
                  : "border-accent bg-accent text-accent-contrast"
                : "border-line bg-surface"
            }`}
          >
            {value === "pending" ? "Leave pending" : "Remove (sold)"}
          </button>
        ))}
      </div>
    </li>
  );
}

/** After "Finish review": what was found, added and changed, and what to do with books not found. */
export function ReviewSummary({
  session,
  titles,
  onBack,
}: {
  session: ReviewSession;
  titles: Record<string, string>;
  onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { found, added, relocated, notFound, unanswered } = evaluate(session);
  const allIds = notFound.map((c) => c.copyId);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Finish reviewing ${session.placeName}`} className="fixed inset-0 z-30 flex flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Finish review</p>
          <h2 className="text-xl font-semibold tracking-tight">{session.placeName}</h2>
        </div>

        <ul aria-label="Review totals" className="grid shrink-0 grid-cols-3 gap-2 text-center">
          {[
            [found.length, "found"],
            [added.length, "added"],
            [relocated.length, "address changed"],
          ].map(([n, label]) => (
            <li key={label} className="rounded-xl border border-line bg-surface p-3">
              <span className="block text-2xl font-semibold">{n}</span>
              <span className="text-xs text-muted">{label}</span>
            </li>
          ))}
        </ul>

        {unanswered > 0 && (
          <>
            <p role="alert" className="text-sm text-warn-text">
              Answer {unanswered === 1 ? "this question" : "these questions"} before saving.
            </p>
            <Questions session={session} titles={titles} />
          </>
        )}

        {notFound.length > 0 ? (
          <section aria-label="Not found" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Not found ({notFound.length})</h3>
              <span className="flex gap-3 text-sm">
                <button type="button" onClick={() => void decideNotFound(allIds, "pending")} className="text-accent">
                  All pending
                </button>
                <button type="button" onClick={() => void decideNotFound(allIds, "remove")} className="text-danger">
                  Remove all
                </button>
              </span>
            </div>
            <p className="px-1 text-sm text-muted">
              Pending books stay listed here, marked missing. If one turns up on another shelf, scanning it there asks whether
              it&apos;s this copy.
            </p>
            <ul className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
              {notFound.map((copy) => (
                <NotFoundRow key={copy.copyId} copy={copy} session={session} />
              ))}
            </ul>
          </section>
        ) : (
          <p className="rounded-xl border border-line bg-surface p-4 text-sm">Every book logged here was found.</p>
        )}

        <div className="mt-auto flex gap-3 pt-2">
          <button type="button" onClick={onBack} disabled={saving} className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium">
            Back to scanning
          </button>
          <button
            type="button"
            disabled={saving || unanswered > 0}
            onClick={async () => {
              setSaving(true);
              try {
                await saveReview();
                onBack();
              } finally {
                setSaving(false);
              }
            }}
            className="h-12 flex-1 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save review"}
          </button>
        </div>
      </div>
    </div>
  );
}
