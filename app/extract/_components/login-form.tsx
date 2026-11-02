"use client";

import { useState } from "react";

/**
 * The access-code login (docs/spec-corrections.md §23), on Extract and on
 * Saved texts. Logs this browser in; the cookie is only sent to /api/extract.
 */
export function LoginForm({ label, hint, onLoggedIn }: { label: string; hint: string; onLoggedIn: () => void }) {
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/extract/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.ok) {
        setCode("");
        onLoggedIn();
      } else setNote(body?.error ?? "Couldn't log in. Try again.");
    } catch {
      setNote("No signal. Logging in needs a connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="AI reading login" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <label htmlFor="extract-code" className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="extract-code"
          type="password"
          autoComplete="current-password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!code.trim() || busy}
          className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast disabled:opacity-40"
        >
          {busy ? "…" : "Log in"}
        </button>
      </div>
      {note && (
        <p role="alert" className="text-sm text-danger">
          {note}
        </p>
      )}
      <p className="text-xs text-muted">{hint}</p>
    </form>
  );
}
