"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { textFileName } from "@/lib/extract-text";
import type { SavedText } from "@/lib/saved-texts";
import { LoginForm } from "../_components/login-form";

/** How often the list checks for new texts while it's on screen. */
const REFRESH_MS = 5000;

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
 */
export function SavedTexts() {
  const [state, setState] = useState<"loading" | "login" | "ready" | "offline">("loading");
  const [texts, setTexts] = useState<SavedText[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = async (t: SavedText) => {
    try {
      await navigator.clipboard.writeText(t.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Couldn't copy. Select the text and copy it by hand.");
    }
  };

  const download = (t: SavedText) => {
    const file = new File([t.text + "\n"], textFileName(t.text, new Date(t.createdAt)), { type: "text/plain" });
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
    setTexts((all) => all.filter((x) => x.id !== t.id));
    setSelected(null);
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
                  onClick={() => setSelected(t.id)}
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
              <button type="button" onClick={() => setSelected(null)} className="self-start text-sm font-medium text-accent md:hidden">
                ← All texts
              </button>
              <p className="text-sm text-muted">
                {when(text.createdAt)}
                {text.updatedAt !== text.createdAt && ` · changed ${when(text.updatedAt)}`} ·{" "}
                {text.source === "phone" ? "read by the phone's own reader — check it carefully" : "read by AI"}
                {text.doneAt && " · ✓ done"}
              </p>
              <div
                aria-label="Text"
                className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-4 text-base leading-relaxed select-text md:text-lg"
              >
                {text.text}
              </div>
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
