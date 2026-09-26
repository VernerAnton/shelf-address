"use client";

import { CONDITIONS, type Condition } from "@/lib/copy-model";

type Props = {
  value: string | null;
  /** Accessible name for the group, e.g. "Condition of 978-…". */
  label: string;
  disabled?: boolean;
} & (
  | { onPick: (condition: Condition | null) => void; name?: never }
  /** Inside a <form>: each chip submits `name=<grade>` (empty to clear). */
  | { name: string; onPick?: never }
);

/**
 * K1–K5 as one-tap buttons. Tapping the grade that's already set clears it.
 */
export function ConditionChips({ value, label, disabled, onPick, name }: Props) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {CONDITIONS.map((grade) => {
        const selected = value === grade;
        const next = selected ? null : grade;
        return (
          <button
            key={grade}
            type={name ? "submit" : "button"}
            name={name}
            value={name ? (next ?? "") : undefined}
            onClick={onPick ? () => onPick(next) : undefined}
            disabled={disabled}
            aria-pressed={selected}
            className={`h-10 min-w-11 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-40 ${
              selected
                ? "border-accent bg-accent text-accent-contrast"
                : "border-line bg-surface text-foreground"
            }`}
          >
            {grade}
          </button>
        );
      })}
    </div>
  );
}
