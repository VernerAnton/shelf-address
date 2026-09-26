"use client";

import { CheckIcon, ClockIcon, WarningIcon } from "@/components/icons";
import { ConditionChips } from "@/components/condition-chips";
import {
  discardScan,
  retryScanHere,
  setScanCondition,
  undoScan,
  type RecentScan,
} from "@/lib/client/scan-store";
import { formatIsbn } from "@/lib/isbn";
import { statusOf, type QueuedOp } from "@/lib/scan-queue";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ScanRow({
  scan,
  queue,
  showPlace,
  hasActivePlace,
}: {
  scan: RecentScan;
  queue: QueuedOp[];
  showPlace: boolean;
  hasActivePlace: boolean;
}) {
  const { status, error } = statusOf(queue, scan.copyId);
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
        <span className="min-w-0 flex-1">
          <span className="block font-mono font-medium">{formatIsbn(scan.isbn13)}</span>
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
            label={`Condition of ${formatIsbn(scan.isbn13)}`}
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
  activePlaceId,
  activePlaceLabel,
}: {
  recent: RecentScan[];
  queue: QueuedOp[];
  activePlaceId: string | null;
  activePlaceLabel: string | null;
}) {
  if (recent.length === 0) return null;

  const failed = (scan: RecentScan) => statusOf(queue, scan.copyId).status === "failed";
  const here = recent.filter((r) => r.locationId === activePlaceId || failed(r));
  const elsewhere = recent.filter((r) => !here.includes(r));
  const row = (scan: RecentScan, showPlace: boolean) => (
    <ScanRow
      key={scan.copyId}
      scan={scan}
      queue={queue}
      showPlace={showPlace || scan.locationId !== activePlaceId}
      hasActivePlace={activePlaceId !== null}
    />
  );

  return (
    <section aria-label="Recent scans" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {activePlaceLabel ? `Scanned into ${activePlaceLabel}` : "Recent scans"}
      </h2>
      <p className="px-1 text-xs text-muted">Titles and covers will show here once book lookup is added.</p>
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
