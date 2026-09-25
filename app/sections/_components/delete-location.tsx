"use client";

import { useActionState, useState } from "react";
import { deleteLocationAction, type DeleteState } from "../actions";

type Props = {
  id: string;
  label: string;
  childCount: number;
  copyCount: number;
};

export function DeleteLocation({ id, label, childCount, copyCount }: Props) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(
    deleteLocationAction,
    { status: "idle" },
  );
  const [confirming, setConfirming] = useState(false);

  if (childCount > 0 || copyCount > 0) {
    const reasons = [
      childCount > 0 && `${childCount} ${childCount === 1 ? "place" : "places"} inside it`,
      copyCount > 0 && `${copyCount} ${copyCount === 1 ? "book" : "books"} logged here`,
    ].filter(Boolean);
    return (
      <p className="text-sm text-muted">
        To delete “{label}”, empty it first — it has {reasons.join(" and ")}.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
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
            {pending ? "Deleting…" : "Yes, delete"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-12 rounded-xl border border-danger/40 font-medium text-danger"
        >
          Delete “{label}”
        </button>
      )}
    </form>
  );
}
