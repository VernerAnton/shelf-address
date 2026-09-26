"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatIsbn } from "@/lib/isbn";
import {
  describePlace,
  logScan,
  refreshPlaces,
  setActivePlace,
  startScanStore,
  useScanState,
} from "@/lib/client/scan-store";
import { CameraScanner } from "./camera-scanner";
import { ManualEntry } from "./manual-entry";
import { PlacePicker } from "./place-picker";
import { RecentScans } from "./recent-scans";
import { SyncStatus } from "./sync-status";

/**
 * Scan tab (Phase 3). Works entirely from what's saved on the phone, so it
 * keeps working with no signal; uploads catch up by themselves.
 */
export function ScanScreen() {
  const state = useScanState();
  const [picking, setPicking] = useState(false);
  const [lastLogged, setLastLogged] = useState<string | null>(null);

  useEffect(() => {
    // Refresh the phone's copy of the tree every time the tab opens, so newly
    // added places are pickable. Harmless with no signal: the old copy stays.
    void startScanStore().then(() => refreshPlaces());
  }, []);

  const active = describePlace(state.places, state.activePlaceId);
  const canScan = state.ready && Boolean(active);

  const onIsbn = useCallback(async (isbn13: string) => {
    await logScan(isbn13);
    setLastLogged(isbn13);
  }, []);

  if (!state.ready) {
    return <p className="p-4 text-muted">Loading…</p>;
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

      <SyncStatus state={state} />

      <CameraScanner disabled={!canScan} onIsbn={onIsbn} />

      {lastLogged && (
        <p role="status" aria-live="polite" className="text-center text-sm text-muted">
          Logged <span className="font-mono font-medium text-foreground">{formatIsbn(lastLogged)}</span>
        </p>
      )}

      <ManualEntry disabled={!canScan} onIsbn={onIsbn} />

      <RecentScans
        recent={state.recent}
        queue={state.queue}
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
