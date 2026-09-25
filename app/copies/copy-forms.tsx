"use client";

import { useActionState, useState } from "react";
import { CONDITION_MAX } from "@/lib/copy-model";
import {
  deleteCopyAction,
  setConditionAction,
  type ConditionState,
  type DeleteCopyState,
} from "./actions";

export function ConditionForm({ id, condition }: { id: string; condition: string | null }) {
  const [state, formAction, pending] = useActionState<ConditionState, FormData>(setConditionAction, {
    status: "idle",
  });
  const [value, setValue] = useState(condition ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="condition" className="text-sm font-medium">
        Condition <span className="font-normal text-muted">(optional)</span>
      </label>
      <div className="flex gap-2">
        <input
          id="condition"
          name="condition"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={CONDITION_MAX}
          placeholder="e.g. torn dust jacket"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast disabled:opacity-60"
        >
          Save
        </button>
      </div>
      {state.status === "saved" && <p role="status" className="text-sm text-muted">Saved.</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
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
