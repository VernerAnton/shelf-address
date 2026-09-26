"use client";

import { useActionState, useState } from "react";
import { AutoTextarea } from "@/components/auto-textarea";
import { PencilIcon } from "@/components/icons";
import { savePanelAction, type PanelState } from "../actions";

export type EditorEntry = { id: string; label: string; depth: number };

type Props = {
  locationId: string;
  label: string;
  howToFind: string;
  notes: Record<string, string>;
  entries: EditorEntry[];
  /** "Add instructions" when there are none yet; otherwise a pencil. */
  empty: boolean;
};

const box =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base leading-snug outline-none focus:border-accent";

/**
 * The instructions panel editor (§3): opened from the pencil on a shelf's (or
 * addressed section's) page, as a popup rather than a screen of its own. It
 * mirrors the places that actually exist inside — each gets a short note that
 * grows if needed — and ends with the larger "How to find a book here" box.
 */
export function PanelEditor({ locationId, label, howToFind, notes, entries, empty }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<PanelState, FormData>(async (previous, formData) => {
    const next = await savePanelAction(previous, formData);
    if (next.status === "saved") setOpen(false);
    return next;
  }, { status: "idle" });

  if (!open) {
    return empty ? (
      <button type="button" onClick={() => setOpen(true)} className="h-11 rounded-xl border border-line bg-surface px-4 font-medium">
        Add instructions
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit instructions for ${label}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted"
      >
        <PencilIcon className="size-5" />
      </button>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Instructions for ${label}`} className="fixed inset-0 z-30 flex flex-col bg-background">
      <form action={formAction} className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <input type="hidden" name="locationId" value={locationId} />
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Instructions for {label}</h2>
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 px-2 py-1 text-accent">
            Cancel
          </button>
        </div>

        {entries.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted">A note for each part, e.g. what&apos;s kept there and how it&apos;s sorted.</legend>
            {entries.map((entry) => (
              <label key={entry.id} className="flex flex-col gap-1" style={{ paddingLeft: `${(entry.depth - 1) * 0.75}rem` }}>
                <span className="text-sm font-medium">{entry.label}:</span>
                <AutoTextarea name={`note:${entry.id}`} defaultValue={notes[entry.id] ?? ""} maxLength={500} className={box} />
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-muted">
            Nothing inside {label} yet. Add sections to it and they&apos;ll each get a note here.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-semibold">How to find a book here</span>
          <span className="text-sm text-muted">
            A worked example works best: &ldquo;Someone wants X — go to the third row, it&apos;s grouped by
            publisher, not author…&rdquo;
          </span>
          <AutoTextarea name="howToFind" defaultValue={howToFind} maxLength={4000} rows={5} className={box} />
        </label>

        {state.status === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => setOpen(false)} className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="h-12 flex-1 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
