"use client";

import Link from "next/link";
import { useActionState } from "react";
import { moveLocationAction, type MoveState } from "../actions";

type Props = {
  id: string;
  targetId: string | null;
  targetName: string;
  /** Why it can't go here, if it can't. */
  blocked: string | null;
  cancelHref: string;
};

export function MoveForm({ id, targetId, targetName, blocked, cancelHref }: Props) {
  const [state, formAction, pending] = useActionState<MoveState, FormData>(
    moveLocationAction,
    { status: "idle" },
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="targetId" value={targetId ?? ""} />
      {blocked && <p className="text-sm text-muted">{blocked}</p>}
      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-danger">
          {state.message}
        </p>
      )}
      <div className="flex gap-3">
        <Link
          href={cancelHref}
          className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line bg-surface font-medium"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending || blocked !== null}
          className="h-12 flex-[2] truncate rounded-xl bg-accent px-3 font-medium text-accent-contrast disabled:opacity-40"
        >
          {pending ? "Moving…" : `Move into ${targetName}`}
        </button>
      </div>
    </form>
  );
}
