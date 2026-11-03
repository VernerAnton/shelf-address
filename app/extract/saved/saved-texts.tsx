"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { textFileName } from "@/lib/extract-text";
import type { SavedText } from "@/lib/saved-texts";
import { LoginForm } from "../_components/login-form";

/** How often the list checks for new texts while it's on screen. */
const REFRESH_MS = 5000;
/** How long typing pauses before a correction is saved. */
const SAVE_AFTER_MS = 800;

/** A correction being typed on the computer: shown instead of the server's text until another text is opened. */
type Draft = { id: string; text: string; status: "saving" | "saved" | "error"; error?: string };

function when(iso: string) {
  return new Date(iso).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

const firstWords = (text: string) => text.replace(/\s+/g, " ").slice(0, 90);

/**
 * Saved texts (docs/spec-corrections.md §24): what Extract read on the
 * phones, ready on the computer — no sharing step. Laid out for a big screen
 * (list on the left, the text on the right) as that's where it's used; on a
 * phone, the list, and a tap opens one. Refreshes itself, so a text read on a
 * phone appears here within seconds.
 *
 * The text can be corrected here (§26) — easier than on a phone. Corrections
 * save by themselves; once a text is corrected here, the phone can't change
 * it any more.
 */
export function SavedTexts() {
  const [state, setState] = useState<"loading" | "login" | "ready" | "offline">("loading");
  const [texts, setTexts] = useState<SavedText[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/extract/texts", { cache: "no-store" });
      if (response.status === 401) return setState("login");
      if (!response.ok) return;
      const { texts } = (await response.json()) as { texts: SavedText[] };
      setTexts(texts);
      setState("ready");
      // On a big screen, show the newest straight away.
      setSelected((s) => s ?? (texts.length && window.matchMedia("(min-width: 768px)").matches ? texts[0].id : null));
    } catch {
      setState((s) => (s === "loading" ? "offline" : s));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (state === "loading") return <p className="text-muted">Loading…</p>;
  if (state === "offline") return <p className="text-muted">No connection. Saved texts are on the server — try again when you&apos;re online.</p>;
  if (state === "login") {
    return (
      <div className="max-w-md">
        <LoginForm
          label="Saved texts need the access code"
          hint="The same code as AI reading on the phones. Asked once in this browser."
          onLoggedIn={() => void load()}
        />
      </div>
    );
  }

  const text = texts.find((t) => t.id === selected) ?? null;
  const shown = text && draft?.id === text.id ? draft.text : (text?.text ?? "");

  /** Saves a correction now (the pending one, if any). */
  const flush = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.run();
  };

  const edit = (t: SavedText, value: string) => {
    setDraft({ id: t.id, text: value, status: "saving" });
    if (pending.current) clearTimeout(pending.current.timer);
    const run = async () => {
      pending.current = null;
      try {
        const response = await fetch(`/api/extract/texts/${t.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Couldn't save the correction.");
        setDraft((d) => (d?.id === t.id && d.text === value ? { ...d, status: "saved" } : d));
        setTexts((all) => all.map((x) => (x.id === t.id ? { ...x, text: value.trim(), editedOnComputerAt: new Date().toISOString() } : x)));
      } catch (e) {
        setDraft((d) => (d?.id === t.id && d.text === value ? { ...d, status: "error", error: (e as Error).message } : d));
      }
    };
    pending.current = { timer: setTimeout(() => void run(), SAVE_AFTER_MS), run: () => void run() };
  };

  const open = (id: string | null) => {
    flush();
    setDraft(null);
    setSelected(id);
  };

  const copy = async (t: SavedText) => {
    try {
      await navigator.clipboard.writeText(shown.trim() || t.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const download = (t: SavedText) => {
    const body = shown.trim() || t.text;
    const file = new File([body + "\n"], textFileName(body, new Date(t.createdAt)), { type: "text/plain" });
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const setDone = async (t: SavedText, done: boolean) => {
    setTexts((all) => all.map((x) => (x.id === t.id ? { ...x, doneAt: done ? new Date().toISOString() : null } : x)));
    await fetch(`/api/extract/texts/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done }) }).catch(() => {});
    void load();
  };

  const remove = async (t: SavedText) => {
    if (!window.confirm("Delete this text? It can't be brought back.")) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setTexts((all) => all.filter((x) => x.id !== t.id));
    open(null);
    await fetch(`/api/extract/texts/${t.id}`, { method: "DELETE" }).catch(() => {});
    void load();
  };

  const button = "flex h-12 items-center justify-center whitespace-nowrap rounded-xl px-3 font-medium md:px-5";

  return (
    <>
      <p className="text-sm text-muted">
        Texts read in <Link href="/extract" className="font-medium text-accent">Extract</Link> on a logged-in phone appear here by
        themselves. Kept for 30 days after their last change.
      </p>

      {texts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing saved yet. Read a back cover in Extract, and it shows up here within a few seconds.
        </p>
      ) : (
        <div className="md:grid md:grid-cols-[20rem_1fr] md:items-start md:gap-6">
          <ul aria-label="Saved texts" className={`overflow-hidden rounded-xl border border-line bg-surface ${text ? "hidden md:block" : ""}`}>
            {texts.map((t) => (
              <li key={t.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  onClick={() => open(t.id)}
                  aria-current={t.id === selected ? "true" : undefined}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${t.id === selected ? "bg-accent/10" : "active:bg-line/50"} ${t.doneAt ? "opacity-55" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{when(t.createdAt)}</span>
                    <span>{t.doneAt ? "✓ Done" : t.source === "phone" ? "Read by phone — check" : "AI"}</span>
                  </span>
                  <span className="line-clamp-2 text-sm">{firstWords(t.text)}</span>
                </button>
              </li>
            ))}
          </ul>

          {text && (
            <section aria-label="Selected text" className="flex flex-col gap-3">
              <button type="button" onClick={() => open(null)} className="self-start text-sm font-medium text-accent md:hidden">
                ← All texts
              </button>
              <p className="text-sm text-muted">
                {when(text.createdAt)}
                {text.updatedAt !== text.createdAt && ` · changed ${when(text.updatedAt)}`} ·{" "}
                {text.source === "phone" ? "read by the phone's own reader — check it carefully" : "read by AI"}
                {text.editedOnComputerAt && " · corrected on the computer"}
                {text.doneAt && " · ✓ done"}
              </p>
              <textarea
                aria-label="Text"
                value={shown}
                onChange={(e) => edit(text, e.target.value)}
                onBlur={flush}
                lang="fi"
                spellCheck
                rows={14}
                className="min-h-72 w-full resize-y rounded-xl border border-line bg-surface p-4 text-base leading-relaxed outline-none focus:border-accent md:text-lg"
              />
              <p role="status" aria-label="Correction" className={`-mt-1 text-sm ${draft?.status === "error" ? "text-danger" : "text-muted"}`}>
                {draft?.id === text.id
                  ? draft.status === "saving"
                    ? "Saving…"
                    : draft.status === "saved"
                      ? "✓ Correction saved. The phone can't change this text any more."
                      : (draft.error ?? "Couldn't save the correction.")
                  : "You can correct the text right here — it saves by itself."}
              </p>
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                <button type="button" onClick={() => void copy(text)} className={`${button} bg-accent text-accent-contrast`}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
                <button type="button" onClick={() => download(text)} className={`${button} border border-line bg-surface`}>
                  Download .txt
                </button>
                <button type="button" onClick={() => void setDone(text, !text.doneAt)} className={`${button} border border-line bg-surface`}>
                  {text.doneAt ? "Not done" : "Mark done"}
                </button>
                <button type="button" onClick={() => void remove(text)} className={`${button} border border-danger/40 text-danger`}>
                  Delete
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
