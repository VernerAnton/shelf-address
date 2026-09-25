"use client";

import { useState } from "react";
import { CheckIcon, ClockIcon, WarningIcon } from "@/components/icons";
import {
  discardScan,
  retryScanHere,
  setScanCondition,
  undoScan,
  type RecentScan,
} from "@/lib/client/scan-store";
import { CONDITION_MAX } from "@/lib/copy-model";
import { formatIsbn } from "@/lib/isbn";
import { statusOf, type QueuedOp } from "@/lib/scan-queue";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ConditionEditor({ scan }: { scan: RecentScan }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(scan.condition ?? "");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(scan.condition ?? "");
          setEditing(true);
        }}
        className="text-left text-sm text-accent"
      >
        {scan.condition ? `Condition: ${scan.condition}` : "+ Add condition"}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void setScanCondition(scan.copyId, value);
        setEditing(false);
      }}
      className="flex gap-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={CONDITION_MAX}
        autoFocus
        aria-label={`Condition of ${scan.isbn13}`}
        placeholder="e.g. torn dust jacket"
        className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-base outline-none focus:border-accent"
      />
      <button type="submit" className="h-10 shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-accent-contrast">
        Save
      </button>
    </form>
  );
}

export function RecentScans({
  recent,
  queue,
  hasActivePlace,
}: {
  recent: RecentScan[];
  queue: QueuedOp[];
  hasActivePlace: boolean;
}) {
  if (recent.length === 0) return null;

  return (
    <section aria-label="Recent scans" className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Recent scans on this phone
      </h2>
      <p className="px-1 text-xs text-muted">Titles and covers will show here once book lookup is added.</p>
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {recent.map((scan) => {
          const { status, error } = statusOf(queue, scan.copyId);
          return (
            <li key={scan.copyId} className="flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-0">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 ${
                    status === "saved" ? "text-emerald-600" : status === "waiting" ? "text-muted" : "text-danger"
                  }`}
                  title={status === "saved" ? "Saved" : status === "waiting" ? "Waiting to upload" : "Not saved"}
                >
                  {status === "saved" ? (
                    <CheckIcon className="size-5" />
                  ) : status === "waiting" ? (
                    <ClockIcon className="size-5" />
                  ) : (
                    <WarningIcon className="size-5" />
                  )}
                  <span className="sr-only">
                    {status === "saved" ? "Saved" : status === "waiting" ? "Waiting to upload" : "Not saved"}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono font-medium">{formatIsbn(scan.isbn13)}</span>
                  <span className="block truncate text-sm text-muted">
                    {time(scan.scannedAt)} · {scan.placeName}
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
                  <ConditionEditor scan={scan} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
