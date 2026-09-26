"use client";

import { useActionState, useState } from "react";
import { ConditionChips } from "@/components/condition-chips";
import {
  deleteCopyAction,
  saveDetailsAction,
  setConditionAction,
  type ConditionState,
  type DeleteCopyState,
  type DetailsState,
} from "./actions";

export function ConditionForm({ id, condition }: { id: string; condition: string | null }) {
  const [state, formAction, pending] = useActionState<ConditionState, FormData>(setConditionAction, {
    status: "idle",
    condition,
  });

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm font-medium">
        Condition <span className="font-normal text-muted">K1 worst · K5 best · tap again to clear</span>
      </p>
      <ConditionChips value={state.condition} label="Condition" name="condition" disabled={pending} />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function DeleteCopy({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState<DeleteCopyState, FormData>(deleteCopyAction, {
    status: "idle",
  });
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      {confirming ? (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium"
          >
            Keep it
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-12 flex-1 rounded-xl bg-danger font-medium text-white disabled:opacity-60"
          >
            {pending ? "Removing…" : "Yes, remove"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-12 rounded-xl border border-danger/40 font-medium text-danger"
        >
          Remove this book
        </button>
      )}
    </form>
  );
}

export function DetailsForm({
  editionKey,
  title,
  author,
  year,
  needsReview,
  onDone,
}: {
  editionKey: string;
  title: string | null;
  author: string | null;
  year: number | null;
  needsReview: boolean;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<DetailsState, FormData>(saveDetailsAction, {
    status: "idle",
  });
  const [values, setValues] = useState({ title: title ?? "", author: author ?? "", year: year ? String(year) : "" });
  const field = "h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="key" value={editionKey} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Title</span>
        <input name="title" required value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Author <span className="font-normal text-muted">(optional)</span></span>
        <input name="author" value={values.author} onChange={(e) => setValues({ ...values, author: e.target.value })} className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Year <span className="font-normal text-muted">(optional)</span></span>
        <input name="year" inputMode="numeric" value={values.year} onChange={(e) => setValues({ ...values, year: e.target.value })} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="reviewed" defaultChecked={!needsReview} className="size-5 accent-[var(--accent)]" />
        These details are checked — no review needed
      </label>
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
      <div className="flex gap-3">
        {onDone && (
          <button type="button" onClick={onDone} className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium">
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending} className="h-12 flex-1 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-60">
          {pending ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}

/** Reveals the details form on demand, so the book page stays uncluttered. */
export function EditDetails(props: Omit<Parameters<typeof DetailsForm>[0], "onDone"> & { label: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="h-12 rounded-xl border border-line bg-surface font-medium">
        {props.label}
      </button>
    );
  }
  return <DetailsForm {...props} onDone={() => setOpen(false)} />;
}
