"use client";

import { useActionState, useState } from "react";
import { EditionFinder, type FoundEdition } from "@/components/edition-finder";
import { reassignAction, type ReassignState } from "./actions";

type Props = {
  copyId: string;
  currentTitle: string;
  /** Other copies logged under the same barcode. */
  sameBarcode: number;
};

/**
 * "Wrong book?" — for a barcode that belongs to a different book (misprints
 * happen). Re-points this copy at the book it really is; the details of the
 * barcode's own book are left alone, since real copies of it may exist.
 */
export function WrongBook({ copyId, currentTitle, sameBarcode }: Props) {
  const [finding, setFinding] = useState(false);
  const [chosen, setChosen] = useState<FoundEdition | null>(null);
  const [state, formAction, pending] = useActionState<ReassignState, FormData>(reassignAction, { status: "idle" });

  if (finding) {
    return (
      <EditionFinder
        heading="Which book is this really?"
        intro={
          <p className="text-sm text-muted">
            Its barcode says <span className="font-medium text-foreground">{currentTitle}</span>. Find the book this
            copy actually is.
          </p>
        }
        online
        allowIsbn
        onCancel={() => setFinding(false)}
        onChoose={(found) => {
          setChosen(found);
          setFinding(false);
        }}
      />
    );
  }

  if (chosen) {
    return (
      <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-accent bg-surface p-4">
        <input type="hidden" name="copyId" value={copyId} />
        <input type="hidden" name="key" value={chosen.key} />
        <input type="hidden" name="title" value={chosen.details?.title ?? ""} />
        <input type="hidden" name="author" value={chosen.details?.author ?? ""} />
        <input type="hidden" name="publisher" value={chosen.details?.publisher ?? ""} />
        <input type="hidden" name="year" value={chosen.details?.year ?? ""} />
        <p>
          Change this copy to <span className="font-semibold">{chosen.label}</span>?
        </p>
        {sameBarcode > 0 && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sameBarcode" className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
            <span>
              Also change the {sameBarcode} other {sameBarcode === 1 ? "copy" : "copies"} logged with this same
              barcode
            </span>
          </label>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => setChosen(null)} className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="h-12 flex-1 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-60">
            {pending ? "Changing…" : "Change"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <button type="button" onClick={() => setFinding(true)} className="h-12 rounded-xl border border-line bg-surface font-medium">
      Wrong book? Pick the right one
    </button>
  );
}
