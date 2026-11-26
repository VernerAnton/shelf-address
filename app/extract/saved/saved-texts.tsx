"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedText } from "@/lib/saved-texts";
import { LoginForm } from "../_components/login-form";
import { CoverPanel, coverUrl } from "./cover-panel";
import { modelLabel } from "@/lib/ai-models";

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
 *
 * Since V28 (§28): the book's front cover shows large beside the text, to
 * judge it and copy it straight into a listing; a bad reading can be reported
 * from here; no Download .txt.
 */
export function SavedTexts() {
  const [state, setState] = useState<"loading" | "login" | "ready" | "offline">("loading");
  const [texts, setTexts] = useState<SavedText[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The picture shown full size (its address: the server's, or a just-edited one), or null.
  const [zoom, setZoom] = useState<string | null>(null);
  const [report, setReport] = useState<{ id: string; note: string; status: "open" | "sending" | "sent" | "error"; error?: string } | null>(null);
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

  // The full-size picture closes with Esc.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);

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
    setReport(null);
    setZoom(null);
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


  /** A bad reading, reported from here: its photos and what came back go to the Photo log (§28). */
  const sendReport = async (t: SavedText, note: string) => {
    setReport({ id: t.id, note, status: "sending" });
    try {
      const response = await fetch(`/api/extract/texts/${t.id}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Couldn't send the report. Try again.");
      setReport({ id: t.id, note, status: "sent" });
    } catch (e) {
      setReport({ id: t.id, note, status: "error", error: (e as Error).message });
    }
  };

  /**
   * Done: the text moves down to the Done section, and the next one still to
   * do opens (on a phone, back to the list). Not done: it moves back up.
   */
  const setDone = async (t: SavedText, done: boolean) => {
    setTexts((all) => all.map((x) => (x.id === t.id ? { ...x, doneAt: done ? new Date().toISOString() : null } : x)));
    if (done) {
      const next = texts.find((x) => !x.doneAt && x.id !== t.id);
      open(next && window.matchMedia("(min-width: 768px)").matches ? next.id : null);
    }
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
  const todo = texts.filter((t) => !t.doneAt);
  const done = texts.filter((t) => t.doneAt);

  const row = (t: SavedText) => (
    <li key={t.id} className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => open(t.id)}
        aria-current={t.id === selected ? "true" : undefined}
        className={`flex w-full gap-3 px-4 py-3 text-left ${t.id === selected ? "bg-accent/10" : "active:bg-line/50"}`}
      >
        {t.coverAt && (
          // eslint-disable-next-line @next/next/no-img-element -- served from our own API behind the login
          <img src={coverUrl(t)} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded bg-line object-cover" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>{when(t.createdAt)}</span>
            <span>{t.doneAt ? "✓ Done" : t.source === "phone" ? "Read by phone — check" : "AI"}</span>
          </span>
          <span className="line-clamp-2 text-sm">{firstWords(t.text)}</span>
        </span>
      </button>
    </li>
  );

  return (
    <>
      <p className="text-sm text-muted">
        Texts read in <Link href="/extract" className="font-medium text-accent">Extract</Link> on a logged-in phone appear here by
        themselves. Kept for 7 days after their last change.
      </p>

      {texts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
          Nothing saved yet. Read a back cover in Extract, and it shows up here within a few seconds.
        </p>
      ) : (
        <div className="md:grid md:grid-cols-[20rem_1fr] md:items-start md:gap-6">
          {/* On a computer the list fits the window and scrolls inside itself, so the page doesn't (V27).
              The heights below allow for both bottom rows: the tabs and Extract's own (BookOps | Text Extract). */}
          <div
            aria-label="Saved texts"
            className={`flex flex-col gap-6 md:max-h-[calc(100dvh-22.5rem)] ${text ? "hidden md:flex" : ""}`}
          >
            <section aria-label="To do" className="flex min-h-0 flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold">To do ({todo.length})</h2>
              {todo.length ? (
                <ul className="min-h-0 overflow-hidden rounded-xl border border-line bg-surface md:overflow-y-auto">{todo.map(row)}</ul>
              ) : (
                <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">Nothing left to do.</p>
              )}
            </section>
            {done.length > 0 && (
              <section aria-label="Done" className="flex min-h-0 flex-col gap-2 md:max-h-[45%]">
                <h2 className="px-1 text-sm font-semibold text-muted">✓ Done ({done.length})</h2>
                <ul className="min-h-0 overflow-hidden rounded-xl border border-line bg-surface opacity-60 md:overflow-y-auto">{done.map(row)}</ul>
              </section>
            )}
          </div>

          {text && (
            <section aria-label="Selected text" className="flex min-w-0 flex-col gap-3">
              <button type="button" onClick={() => open(null)} className="self-start text-sm font-medium text-accent md:hidden">
                ← All texts
              </button>
              <p className="text-sm text-muted">
                {when(text.createdAt)}
                {text.updatedAt !== text.createdAt && ` · changed ${when(text.updatedAt)}`} ·{" "}
                {text.source === "phone" ? "read by the phone's own reader — check it carefully" : "read by AI"}
                {/* Which model (V33.4), while models are being compared. */}
                {text.source !== "phone" && text.aiModels.length > 0 && ` (${[...new Set(text.aiModels.map(modelLabel))].join(", ")})`}
                {/* How long the AI took (V33.1): one time per photo of the back. */}
                {text.source !== "phone" && text.aiMs.length > 0 && ` in ${text.aiMs.map((ms) => `${(ms / 1000).toFixed(1)} s`).join(" + ")}`}
                {text.editedOnComputerAt && " · corrected on the computer"}
                {!text.coverAt && " · no front cover photo"}
              </p>
              {text.doneAt && <p className="-mt-1 text-sm font-medium text-muted">✓ Done — moved to the Done list.</p>}
              <div className={text.coverAt ? "flex flex-col gap-4 md:flex-row md:items-start" : ""}>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <textarea
                    aria-label="Text"
                    value={shown}
                    onChange={(e) => edit(text, e.target.value)}
                    onBlur={flush}
                    lang="fi"
                    spellCheck
                    rows={14}
                    className={`min-h-72 w-full resize-y rounded-xl border border-line bg-surface p-4 text-base leading-relaxed outline-none focus:border-accent md:min-h-48 md:text-lg ${
                      // Beside a cover the buttons take two rows: a little less height keeps the page from scrolling.
                      // On a wide screen (the page grows with a cover) they fit on one row again.
                      text.coverAt ? "md:h-[calc(100dvh-31.5rem)] xl:h-[calc(100dvh-28rem)]" : "md:h-[calc(100dvh-24.5rem)]"
                    }`}
                  />
                  <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
                    <button type="button" onClick={() => void copy(text)} className={`${button} min-w-[7.5rem] bg-accent text-accent-contrast`}>
                      {copied ? "Copied ✓" : "Copy"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void setDone(text, !text.doneAt)}
                      className={`${button} border border-line bg-surface`}
                    >
                      {text.doneAt ? "Not done" : "✓ Mark done"}
                    </button>
                    <button type="button" onClick={() => void remove(text)} className={`${button} border border-danger/40 text-danger`}>
                      Delete
                    </button>
                    {report?.id !== text.id && (
                      <button
                        type="button"
                        onClick={() => setReport({ id: text.id, note: "", status: "open" })}
                        aria-label="Report a problem"
                        className={`${button} whitespace-normal bg-danger text-center leading-tight text-background`}
                      >
                        {/* On two lines, so it fits beside the others on one row (V31). */}
                        <span>
                          Report a
                          <br />
                          problem
                        </span>
                      </button>
                    )}
                    {/* Beside the buttons, not on a line of its own: the text box gets that height (V33.10). */}
                    <p role="status" aria-label="Correction" className={`col-span-2 self-center text-sm md:min-w-40 md:flex-1 ${draft?.status === "error" ? "text-danger" : "text-muted"}`}>
                      {draft?.id === text.id
                        ? draft.status === "saving"
                          ? "Saving…"
                          : draft.status === "saved"
                            ? "✓ Correction saved. The phone can't change this text any more."
                            : (draft.error ?? "Couldn't save the correction.")
                        : "Corrections save by themselves."}
                    </p>
                  </div>
                </div>

                {text.coverAt && <CoverPanel text={text} button={button} onZoom={setZoom} onChanged={load} />}
              </div>

              {report?.id === text.id && (
                <div role="region" aria-label="Report a problem" className="flex max-w-xl flex-col gap-2 rounded-xl border border-danger/40 p-3">
                  {report.status === "sent" ? (
                    <p role="status" className="text-sm text-muted">
                      ✓ Reported — the photo and what the AI sent back are in the{" "}
                      <Link href="/photo-log" className="font-medium text-accent">
                        Photo log
                      </Link>
                      , to find out what went wrong.
                    </p>
                  ) : (
                    <>
                      <label htmlFor="report-note" className="text-sm font-medium">
                        What went wrong? <span className="font-normal text-muted">(optional)</span>
                      </label>
                      <textarea
                        id="report-note"
                        value={report.note}
                        onChange={(e) => setReport({ ...report, note: e.target.value })}
                        rows={2}
                        placeholder="For example: cut off after the second paragraph"
                        className="w-full rounded-xl border border-line bg-surface p-3 text-base outline-none focus:border-accent"
                      />
                      {report.status === "error" && <p className="text-sm text-danger">{report.error}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={report.status === "sending"}
                          onClick={() => void sendReport(text, report.note.trim())}
                          className={`${button} bg-danger text-background disabled:opacity-40`}
                        >
                          {report.status === "sending" ? "Sending…" : "Send report"}
                        </button>
                        <button type="button" onClick={() => setReport(null)} className={`${button} border border-line bg-surface`}>
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {text?.coverAt && zoom && (
            <div
              role="dialog"
              aria-label="Front cover, full size"
              onClick={() => setZoom(null)}
              className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API behind the login */}
              <img src={zoom} alt="Front cover, full size" className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
