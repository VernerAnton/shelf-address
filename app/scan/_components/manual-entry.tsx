"use client";

import { useState } from "react";
import { parseIsbn } from "@/lib/isbn";

/** Typing an ISBN when a barcode is damaged or missing its digits (spec §6). */
export function ManualEntry({ disabled, onIsbn }: { disabled: boolean; onIsbn: (isbn13: string) => void }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseIsbn(value);
    if (!parsed.ok) {
      setMessage({ kind: "error", text: parsed.reason });
      return;
    }
    onIsbn(parsed.isbn13);
    setValue("");
    setMessage(
      parsed.convertedFrom10
        ? { kind: "info", text: `Logged as ${parsed.isbn13} (converted from the 10-digit ISBN).` }
        : null,
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="manual-isbn" className="text-sm font-medium">
        Or type the ISBN
      </label>
      <div className="flex gap-2">
        <input
          id="manual-isbn"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="978…"
          disabled={disabled}
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-base outline-none focus:border-accent disabled:opacity-40"
        />
        {/* Older 10-digit ISBNs can end in X, which the number pad lacks. */}
        <button
          type="button"
          onClick={() => setValue((v) => v + "X")}
          disabled={disabled}
          aria-label="Type X"
          className="h-12 w-12 shrink-0 rounded-xl border border-line bg-surface font-mono font-medium disabled:opacity-40"
        >
          X
        </button>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast disabled:opacity-40"
        >
          Log
        </button>
      </div>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm ${message.kind === "error" ? "text-danger" : "text-muted"}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
