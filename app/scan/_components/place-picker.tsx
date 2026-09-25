"use client";

import { useMemo, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { byDisplayOrder, pathIn, type Location } from "@/lib/location-model";
import { KIND_LABEL, KindIcon } from "@/app/sections/_components/kind";

type Props = {
  locations: Location[];
  startAt: string | null;
  onChoose: (id: string) => void;
  onCancel: () => void;
  staleNote: string | null;
};

/**
 * Drill-down picker for "where am I standing", driven entirely by the copy of
 * the tree saved on the phone — so it works with no signal at the warehouse.
 * Sites can be entered but not chosen: books are never logged at a site.
 */
export function PlacePicker({ locations, startAt, onChoose, onCancel, staleNote }: Props) {
  const [at, setAt] = useState<string | null>(() => {
    const start = startAt ? pathIn(locations, startAt).at(-1) : undefined;
    return start?.parentId ?? null;
  });

  const path = useMemo(() => (at ? pathIn(locations, at) : []), [locations, at]);
  const here = path.at(-1);
  const children = useMemo(
    () => locations.filter((l) => l.parentId === (at ?? null)).sort(byDisplayOrder),
    [locations, at],
  );
  const childCount = (id: string) => locations.filter((l) => l.parentId === id).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose where you are"
      className="fixed inset-0 z-30 flex flex-col bg-background"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Where are you?</h2>
          <button type="button" onClick={onCancel} className="px-2 py-1 text-accent">
            Cancel
          </button>
        </div>
        {staleNote && <p className="text-sm text-muted">{staleNote}</p>}

        <nav aria-label="Picker breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => setAt(null)} className="px-1 py-1 text-accent">
            All places
          </button>
          {path.map((l, i) => (
            <span key={l.id} className="flex items-center gap-1">
              <span aria-hidden className="text-muted">›</span>
              {i < path.length - 1 ? (
                <button type="button" onClick={() => setAt(l.id)} className="px-1 py-1 text-accent">
                  {l.label}
                </button>
              ) : (
                <span className="px-1 py-1 text-muted">{l.label}</span>
              )}
            </span>
          ))}
        </nav>

        {children.length > 0 ? (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {children.map((child) => {
              const inside = childCount(child.id);
              return (
                <li key={child.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => (inside > 0 || child.kind === "site" ? setAt(child.id) : onChoose(child.id))}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-line/50"
                  >
                    <KindIcon kind={child.kind} className="size-5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium">{child.label}</span>
                        {child.address && (
                          <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">
                            {child.address}
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-muted">
                        {KIND_LABEL[child.kind]}
                        {inside > 0 ? ` · ${inside} inside` : ""}
                      </span>
                    </span>
                    {inside > 0 || child.kind === "site" ? (
                      <ChevronRightIcon className="size-5 shrink-0 text-muted" />
                    ) : (
                      <span className="shrink-0 text-sm font-medium text-accent">Choose</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            {locations.length === 0
              ? "No places yet. Add your sites, shelves and sections under Sections first."
              : "Nothing inside here."}
          </p>
        )}

        {here && here.kind !== "site" && (
          <button
            type="button"
            onClick={() => onChoose(here.id)}
            className="mt-auto h-12 shrink-0 rounded-xl bg-accent font-medium text-accent-contrast"
          >
            Log books at “{here.label}”
          </button>
        )}
      </div>
    </div>
  );
}
