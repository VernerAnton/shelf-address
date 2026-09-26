"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { CoverCamera } from "@/components/cover-camera";
import { CameraIcon, CheckIcon, ClockIcon, WarningIcon } from "@/components/icons";
import { ConditionChips } from "@/components/condition-chips";
import {
  addCoverPhoto,
  discardCoverPhoto,
  discardScan,
  retryScanHere,
  setScanCondition,
  undoScan,
  type EditionSummary,
  type RecentScan,
} from "@/lib/client/scan-store";
import { keyLabel } from "@/lib/edition-key";
import { coverUploadOf, statusOf, type QueuedOp } from "@/lib/scan-queue";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ScanRow({
  scan,
  queue,
  edition,
  localCover,
  online,
  showPlace,
  hasActivePlace,
  onPhotograph,
}: {
  scan: RecentScan;
  queue: QueuedOp[];
  edition: EditionSummary | undefined;
  localCover: string | undefined;
  online: boolean;
  showPlace: boolean;
  hasActivePlace: boolean;
  onPhotograph: () => void;
}) {
  const { status, error } = statusOf(queue, scan.copyId);
  const cover = localCover ?? edition?.coverUrl ?? null;
  const coverUpload = coverUploadOf(queue, scan.isbn13);
  // Offer the camera once the lookup has come back without a cover — or
  // straight away with no signal, when no lookup can happen yet.
  const lookupDone = edition !== undefined && edition.lookupStatus !== "pending";
  const offerPhoto = !cover && status !== "failed" && (lookupDone || (!online && edition === undefined));
  const title = edition?.title ?? scan.title ?? null;
  const author = edition?.author ?? scan.author ?? null;
  const lookupNote =
    status !== "saved"
      ? null
      : edition?.lookupStatus === "not_found"
        ? "Not found — open the book from its place to add details"
        : edition?.lookupStatus === "skipped"
          ? null
          : "Looking up title…";
  const statusLabel = status === "saved" ? "Saved" : status === "waiting" ? "Waiting to upload" : "Not saved";
  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 ${
            status === "saved" ? "text-emerald-600" : status === "waiting" ? "text-muted" : "text-danger"
          }`}
          title={statusLabel}
        >
          {status === "saved" ? (
            <CheckIcon className="size-5" />
          ) : status === "waiting" ? (
            <ClockIcon className="size-5" />
          ) : (
            <WarningIcon className="size-5" />
          )}
          <span className="sr-only">{statusLabel}</span>
        </span>
        <BookCover src={cover} />
        <span className="min-w-0 flex-1">
          {title ? (
            <>
              <span className="line-clamp-2 font-medium leading-snug">{title}</span>
              <span className="block truncate text-sm text-muted">
                {[author, keyLabel(scan.isbn13)].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            <>
              <span className="block font-mono font-medium">{keyLabel(scan.isbn13)}</span>
              {lookupNote && <span className="block text-sm text-muted">{lookupNote}</span>}
            </>
          )}
          <span className="block truncate text-sm text-muted">
            {time(scan.scannedAt)}
            {showPlace && ` · ${scan.placeName}`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void undoScan(scan.copyId)}
          className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-medium"
        >
          Undo
        </button>
      </div>
      {offerPhoto && (
        <div className="flex items-center gap-3 pl-8">
          <button
            type="button"
            onClick={onPhotograph}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium"
          >
            <CameraIcon className="size-4" />
            Photograph cover
          </button>
          {lookupDone && <span className="text-sm text-muted">No cover found</span>}
        </div>
      )}
      {coverUpload?.state === "waiting" && !online && (
        <p className="pl-8 text-sm text-muted">Cover photo saved on this phone — uploads when there&apos;s signal.</p>
      )}
      {coverUpload?.state === "failed" && (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          <p className="w-full text-sm text-danger">Cover photo not saved: {coverUpload.error}</p>
          <button type="button" onClick={onPhotograph} className="h-9 rounded-lg border border-line px-3 text-sm font-medium">
            Take it again
          </button>
          <button
            type="button"
            onClick={() => void discardCoverPhoto(scan.isbn13)}
            className="h-9 rounded-lg border border-line px-3 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}
      {status === "failed" ? (
        <div className="flex flex-col gap-2 pl-8">
          <p className="text-sm text-danger">{error}</p>
          <div className="flex flex-wrap gap-2">
            {hasActivePlace && (
              <button
                type="button"
                onClick={() => void retryScanHere(scan.copyId)}
                className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-contrast"
              >
                Log at current place instead
              </button>
            )}
            <button
              type="button"
              onClick={() => void discardScan(scan.copyId)}
              className="h-9 rounded-lg border border-line px-3 text-sm font-medium"
            >
              Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="pl-8">
          <ConditionChips
            value={scan.condition}
            label={`Condition of ${title ?? keyLabel(scan.isbn13)}`}
            onPick={(condition) => void setScanCondition(scan.copyId, condition)}
          />
        </div>
      )}
    </li>
  );
}

/**
 * This phone's recent scans, split by the place currently being scanned into.
 * Scans from other places are tucked away and labelled with where they went,
 * so a list under "Row 2" is never mistaken for books that are in Row 2.
 * Scans that couldn't be saved stay in view whichever place they were for.
 */
export function RecentScans({
  recent,
  queue,
  editions,
  localCovers,
  online,
  activePlaceId,
  activePlaceLabel,
}: {
  recent: RecentScan[];
  queue: QueuedOp[];
  editions: Record<string, EditionSummary>;
  localCovers: Record<string, string>;
  online: boolean;
  activePlaceId: string | null;
  activePlaceLabel: string | null;
}) {
  const [photographing, setPhotographing] = useState<RecentScan | null>(null);
  if (recent.length === 0) return null;

  const failed = (scan: RecentScan) => statusOf(queue, scan.copyId).status === "failed";
  const here = recent.filter((r) => r.locationId === activePlaceId || failed(r));
  const elsewhere = recent.filter((r) => !here.includes(r));
  const row = (scan: RecentScan, showPlace: boolean) => (
    <ScanRow
      key={scan.copyId}
      scan={scan}
      queue={queue}
      edition={editions[scan.isbn13]}
      localCover={localCovers[scan.isbn13]}
      online={online}
      showPlace={showPlace || scan.locationId !== activePlaceId}
      hasActivePlace={activePlaceId !== null}
      onPhotograph={() => setPhotographing(scan)}
    />
  );

  const photoTitle = photographing
    ? (editions[photographing.isbn13]?.title ?? photographing.title ?? keyLabel(photographing.isbn13))
    : "";

  return (
    <section aria-label="Recent scans" className="flex flex-col gap-2">
      {photographing && (
        <CoverCamera
          title={photoTitle}
          onSave={(photo) => addCoverPhoto(photographing.copyId, photographing.isbn13, photo)}
          onClose={() => setPhotographing(null)}
        />
      )}
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {activePlaceLabel ? `Scanned into ${activePlaceLabel}` : "Recent scans"}
      </h2>
      <p className="px-1 text-xs text-muted">Condition: K1 worst · K5 best</p>
      {here.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {here.map((scan) => row(scan, false))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          Nothing scanned here yet on this phone.
        </p>
      )}

      {elsewhere.length > 0 && (
        <details className="group mt-1">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl border border-line bg-surface px-4 text-sm font-medium">
            Recent scans in other places ({elsewhere.length})
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
            {elsewhere.map((scan) => row(scan, true))}
          </ul>
        </details>
      )}
    </section>
  );
}
