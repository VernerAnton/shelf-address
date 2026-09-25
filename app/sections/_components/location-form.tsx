"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { WarningIcon } from "@/components/icons";
import { displayAddress } from "@/lib/address";
import {
  ADDRESS_MAX,
  LABEL_MAX,
  canHaveAddress,
  requiresAddress,
  type AddressHolder,
  type LocationKind,
} from "@/lib/location-model";
import type { FormValues, LocationFormState } from "../actions";
import { KIND_HINT, KIND_LABEL, KindIcon } from "./kind";

type Props = {
  action: (state: LocationFormState, formData: FormData) => Promise<LocationFormState>;
  /** Hidden fields identifying what's being created or edited. */
  hidden: Record<string, string>;
  kinds: LocationKind[];
  initial: FormValues;
  submitLabel: string;
  cancelHref: string;
};

function holderLine(holder: AddressHolder) {
  const kind = KIND_LABEL[holder.kind].toLowerCase();
  return `${displayAddress(holder.address, holder.siteLabel)} (${kind} “${holder.label}”)`;
}

export function LocationForm({
  action,
  hidden,
  kinds,
  initial,
  submitLabel,
  cancelHref,
}: Props) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const feedbackRef = useRef<HTMLDivElement>(null);

  // On a phone the feedback lands above the button that was just tapped,
  // often off-screen. Bring it into view whenever the server sends some.
  useEffect(() => {
    if (state.status !== "idle") {
      feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state]);

  // Controlled, so nothing typed is lost when the server sends back a warning.
  const [label, setLabel] = useState(initial.label);
  const [kind, setKind] = useState<LocationKind>(initial.kind);
  const [address, setAddress] = useState(initial.address);

  // A warning applies only to the exact address it was raised for. Editing
  // the address makes it disappear rather than lingering over new text.
  const warningStillApplies =
    (state.status === "taken" || state.status === "similar") &&
    state.values.address === address &&
    canHaveAddress(kind);
  const addressRequired = requiresAddress(kind);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {/*
        The kind is submitted from React state, never from the radios. React 19
        resets a form after each action, which puts radios back to their
        initial checked state in the DOM while this component's state (and so
        the screen) still shows the person's choice. Submitting the radios
        would then silently save the wrong kind.
      */}
      <input type="hidden" name="kind" value={kind} />

      {kinds.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What is it?</legend>
          <div className="flex flex-col gap-2">
            {kinds.map((k) => (
              <label
                key={k}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                  kind === k ? "border-accent bg-accent/5" : "border-line bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="sr-only"
                />
                <KindIcon
                  kind={k}
                  className={`mt-0.5 size-5 shrink-0 ${kind === k ? "text-accent" : "text-muted"}`}
                />
                <span>
                  <span className="block font-medium">{KIND_LABEL[k]}</span>
                  <span className="block text-sm text-muted">{KIND_HINT[k]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <input
          name="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={LABEL_MAX}
          autoComplete="off"
          placeholder={
            kind === "site" ? "e.g. Store" : kind === "shelf" ? "e.g. Wall by the window" : "e.g. Section 2"
          }
          className="h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        />
      </label>

      {canHaveAddress(kind) && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-address`} className="text-sm font-medium">
            Address
            {!addressRequired && <span className="font-normal text-muted"> (optional)</span>}
          </label>
          <input
            id={`${id}-address`}
            aria-describedby={`${id}-address-hint`}
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required={addressRequired}
            maxLength={ADDRESS_MAX}
            autoComplete="off"
            autoCapitalize="words"
            placeholder="e.g. Bulevard 1"
            className="h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
          />
          <p id={`${id}-address-hint`} className="text-sm text-muted">
            {!addressRequired &&
              "Give it one if it's a spot you'd walk to, like a table or a corner. "}
            Unique across every site. Don&apos;t include the site name — it&apos;s added
            automatically when the address is shown.
          </p>
        </div>
      )}

      <div ref={feedbackRef} className="flex flex-col gap-6 empty:hidden">
      {state.status === "error" && (
        <p role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-danger">
          {state.message}
        </p>
      )}

      {warningStillApplies && state.status === "taken" && (
        <div role="alert" className="rounded-xl border border-warn-line bg-warn-bg p-4 text-warn-text">
          <p className="flex gap-2 font-medium">
            <WarningIcon className="mt-0.5 size-5 shrink-0" />
            “{address}” is already in use
          </p>
          <p className="mt-2 text-sm">
            It belongs to {holderLine(state.holder)}. Each address can be on only
            one shelf. Moving it here leaves that shelf with no address.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              name="confirm"
              value="take"
              disabled={pending}
              className="h-10 rounded-lg bg-warn-text px-4 text-sm font-medium text-warn-bg disabled:opacity-60"
            >
              Move address here
            </button>
          </div>
          <p className="mt-2 text-sm">Or type a different address above.</p>
        </div>
      )}

      {warningStillApplies && state.status === "similar" && (
        <div role="alert" className="rounded-xl border border-warn-line bg-warn-bg p-4 text-warn-text">
          <p className="flex gap-2 font-medium">
            <WarningIcon className="mt-0.5 size-5 shrink-0" />
            This looks like an address you already have
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {state.matches.map((m) => (
              <li key={m.id}>{holderLine(m)}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            If it&apos;s the same place with the site name added, use the existing address
            instead — the site is shown automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              name="confirm"
              value="similar"
              disabled={pending}
              className="h-10 rounded-lg bg-warn-text px-4 text-sm font-medium text-warn-bg disabled:opacity-60"
            >
              It&apos;s different — save anyway
            </button>
          </div>
        </div>
      )}

      </div>

      <div className="flex gap-3">
        <Link
          href={cancelHref}
          className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line bg-surface font-medium"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="h-12 flex-1 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
