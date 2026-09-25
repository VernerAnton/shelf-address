"use client";

import { CheckIcon, CloudOffIcon } from "@/components/icons";
import type { ScanState } from "@/lib/client/scan-store";

/** One line saying whether scans are safely on the server yet. */
export function SyncStatus({ state }: { state: ScanState }) {
  const waiting = state.queue.filter((q) => q.state === "waiting").length;
  const failed = new Set(state.queue.filter((q) => q.state === "failed").map((q) => q.copyId)).size;
  const scans = (n: number) => `${n} ${n === 1 ? "change" : "changes"}`;

  if (state.needsLogin) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-text">
        <p>
          Your login has expired. {waiting > 0 ? `${scans(waiting)} are safe on this phone and will upload after you log in.` : ""}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-10 self-start rounded-lg bg-warn-text px-4 font-medium text-warn-bg"
        >
          Log in again
        </button>
      </div>
    );
  }

  if (waiting > 0 && !state.online) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn-text">
        <CloudOffIcon className="size-5 shrink-0" />
        No signal. {scans(waiting)} saved on this phone — they upload by themselves when the
        signal is back.
      </p>
    );
  }

  if (waiting > 0) {
    return (
      <p role="status" className="rounded-xl border border-line bg-surface p-3 text-sm text-muted">
        Uploading {scans(waiting)}…
      </p>
    );
  }

  if (failed > 0) {
    return (
      <p role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-danger">
        {failed} {failed === 1 ? "scan couldn't" : "scans couldn't"} be saved — see below.
      </p>
    );
  }

  if (!state.online) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm text-muted">
        <CloudOffIcon className="size-5 shrink-0" />
        No signal. You can keep scanning — books are saved on this phone and upload later.
      </p>
    );
  }

  if (state.recent.length > 0) {
    return (
      <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted">
        <CheckIcon className="size-4 shrink-0 text-emerald-600" />
        Everything is saved.
      </p>
    );
  }

  return null;
}
