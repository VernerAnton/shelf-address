"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatIsbn } from "@/lib/isbn";
import {
  describePlace,
  discardScan,
  logScan,
  refreshPlaces,
  setActivePlace,
  startScanStore,
  useScanState,
} from "@/lib/client/scan-store";
import { prefetchVision } from "@/lib/client/cover-vision";
import {
  dismissSaved,
  reviewScan,
  ReviewStartError,
  startReview,
  startReviewStore,
  useReviewState,
} from "@/lib/client/review-store";
import { lastScanLine, ReviewHeader, ReviewLists, ReviewSummary } from "./review-panel";
import { CameraScanner } from "./camera-scanner";
import { ManualEntry } from "./manual-entry";
import { NoBarcode } from "./no-barcode";
import { PlacePicker } from "./place-picker";
import { RecentScans } from "./recent-scans";
import { SyncStatus } from "./sync-status";

/**
 * Scan tab (Phase 3). Works entirely from what's saved on the phone, so it
 * keeps working with no signal; uploads catch up by themselves.
 */
export function ScanScreen() {
  const state = useScanState();
  const review = useReviewState();
  const [picking, setPicking] = useState(false);
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    // Refresh the phone's copy of the tree every time the tab opens, so newly
    // added places are pickable. Harmless with no signal: the old copy stays.
    void startScanStore().then(() => refreshPlaces());
    void startReviewStore();
    // Get the cover camera's edge detection onto the phone while there's signal.
    prefetchVision();
  }, []);

  const active = describePlace(state.places, state.activePlaceId);
  const canScan = state.ready && Boolean(active);

  const onIsbn = useCallback(async (isbn13: string) => {
    await logScan(isbn13);
    setLastLogged(formatIsbn(isbn13));
  }, []);

  const onReviewIsbn = useCallback((isbn13: string) => void reviewScan(isbn13), []);

  if (!state.ready || !review.ready) {
    return <p className="p-4 text-muted">Loading…</p>;
  }

  const failedReviews = state.queue.filter((q) => q.kind === "review" && q.state === "failed");
  const reviewNotices = (
    <>
      {review.saved && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p className="flex-1">
            <strong>Review of {review.saved.placeName} saved.</strong> {review.saved.found} found
            {review.saved.added > 0 && `, ${review.saved.added} added`}
            {review.saved.relocated > 0 && `, ${review.saved.relocated} address ${review.saved.relocated === 1 ? "change" : "changes"}`}
            {review.saved.removed > 0 && `, ${review.saved.removed} removed`}
            {review.saved.pending > 0 && `, ${review.saved.pending} pending`}.
          </p>
          <button type="button" onClick={dismissSaved} className="shrink-0 text-accent">
            OK
          </button>
        </div>
      )}
      {failedReviews.map((q) =>
        q.kind === "review" ? (
          <div key={q.copyId} role="alert" className="flex flex-col gap-2 rounded-xl border border-danger/40 p-3 text-sm text-danger">
            <p>
              The review of {q.placeName} couldn&apos;t be saved: {q.error}
            </p>
            <button type="button" onClick={() => void discardScan(q.copyId)} className="h-9 self-start rounded-lg border border-line px-3 font-medium text-foreground">
              Discard it
            </button>
          </div>
        ) : null,
      )}
    </>
  );

  if (review.session) {
    const line = lastScanLine(review.session, review.titles);
    return (
      <>
        <ReviewHeader session={review.session} onFinish={() => setFinishing(true)} />
        <SyncStatus state={state} />
        <CameraScanner disabled={false} onIsbn={onReviewIsbn} />
        {line && (
          <p role="status" aria-live="polite" className="text-center text-sm">
            {line}
          </p>
        )}
        <ManualEntry disabled={false} onIsbn={onReviewIsbn} />
        <ReviewLists session={review.session} titles={review.titles} />
        {finishing && <ReviewSummary session={review.session} titles={review.titles} onBack={() => setFinishing(false)} />}
      </>
    );
  }

  const staleNote =
    !state.online && state.places
      ? `No signal — showing places as of ${new Date(state.places.fetchedAt).toLocaleString([], {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}.`
      : null;

  return (
    <>
      <section
        aria-label="Where books are being logged"
        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Logging books at</p>
          {active ? (
            <>
              <p className="truncate text-lg font-semibold">{active.place.label}</p>
              <p className="truncate text-sm text-accent">
                {active.address ?? active.path.map((l) => l.label).join(" › ")}
              </p>
            </>
          ) : (
            <p className="text-muted">
              {state.places && state.places.locations.length === 0
                ? "No places yet."
                : "Choose where you're standing."}
            </p>
          )}
        </div>
        {state.places && state.places.locations.length > 0 ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className={`h-11 shrink-0 rounded-xl px-4 font-medium ${
              active ? "border border-line" : "bg-accent text-accent-contrast"
            }`}
          >
            {active ? "Change" : "Choose"}
          </button>
        ) : state.places ? (
          <Link href="/sections" className="h-11 shrink-0 rounded-xl bg-accent px-4 leading-[2.75rem] font-medium text-accent-contrast">
            Add places
          </Link>
        ) : (
          <span className="text-sm text-muted">Needs signal once to load places</span>
        )}
      </section>

      {active && active.place.kind !== "site" && (
        <div className="-mt-2 flex flex-col gap-1">
          <button
            type="button"
            disabled={review.starting}
            onClick={async () => {
              setReviewError(null);
              try {
                await startReview(active.place.id);
              } catch (e) {
                setReviewError(e instanceof ReviewStartError ? e.message : "Couldn't start the review. Try again.");
              }
            }}
            className="h-11 rounded-xl border border-line bg-surface text-sm font-medium disabled:opacity-60"
          >
            {review.starting ? "Starting review…" : `Review ${active.place.label}: check what's there`}
          </button>
          {reviewError && (
            <p role="alert" className="text-sm text-danger">
              {reviewError}
            </p>
          )}
        </div>
      )}

      {reviewNotices}
      <SyncStatus state={state} />

      <CameraScanner disabled={!canScan} onIsbn={onIsbn} />

      {lastLogged && (
        <p role="status" aria-live="polite" className="text-center text-sm text-muted">
          Logged <span className="font-medium text-foreground">{lastLogged}</span>
        </p>
      )}

      <ManualEntry disabled={!canScan} onIsbn={onIsbn} />

      <NoBarcode disabled={!canScan} online={state.online} onPicked={setLastLogged} />

      <RecentScans
        recent={state.recent}
        queue={state.queue}
        editions={state.editions}
        localCovers={state.localCovers}
        online={state.online}
        activePlaceId={active ? state.activePlaceId : null}
        activePlaceLabel={active?.place.label ?? null}
      />

      {picking && state.places && (
        <PlacePicker
          locations={state.places.locations}
          startAt={state.activePlaceId}
          staleNote={staleNote}
          onCancel={() => setPicking(false)}
          onChoose={(id) => {
            void setActivePlace(id);
            setPicking(false);
            // "Logged …" refers to the previous place; don't let it read as this one.
            if (id !== state.activePlaceId) setLastLogged(null);
          }}
        />
      )}
    </>
  );
}
