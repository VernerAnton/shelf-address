"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { logScan } from "@/lib/client/scan-store";
import { keyLabel } from "@/lib/edition-key";
import type { EditionChoice } from "@/lib/lookup/types";

type Props = {
  disabled: boolean;
  online: boolean;
  /** Called with the logged edition's label, for the "Logged …" line. */
  onPicked: (label: string) => void;
};

type Search =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "done"; choices: EditionChoice[] }
  | { state: "error"; message: string };

const field = "h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent";

/**
 * Logging a book with no barcode (spec §2.2 open item; spec-corrections §12):
 * search Finna by title/author and pick the edition, or — with no match, or
 * no signal — type it in by hand, which marks it "needs review".
 */
export function NoBarcode({ disabled, online, onPicked }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [byHand, setByHand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setSearch({ state: "idle" });
    setByHand(false);
    setError(null);
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !author.trim()) return;
    setSearch({ state: "searching" });
    try {
      const params = new URLSearchParams({ title: title.trim(), author: author.trim() });
      const response = await fetch(`/api/finna-search?${params}`, { cache: "no-store" });
      const body = (await response.json()) as { choices: EditionChoice[]; error?: string };
      setSearch(
        response.ok
          ? { state: "done", choices: body.choices }
          : { state: "error", message: body.error ?? "Finna didn't answer." },
      );
    } catch {
      setSearch({ state: "error", message: "No connection to Finna. Enter the book by hand instead." });
    }
  };

  const pick = async (choice: EditionChoice) => {
    // A result with an ISBN is logged exactly as if its barcode was scanned,
    // so it joins other copies of that edition.
    if (choice.isbn13) {
      await logScan(choice.isbn13);
      onPicked(choice.title);
    } else {
      await logScan(`finna:${choice.finnaId}`, {
        title: choice.title,
        author: choice.author,
        year: choice.year,
        publisher: choice.publisher,
      });
      onPicked(choice.title);
    }
    close();
  };

  const saveByHand = async (e: React.FormEvent) => {
    e.preventDefault();
    const y = year.trim() ? Number(year) : null;
    if (!title.trim()) return setError("A title is needed.");
    if (y !== null && (!Number.isInteger(y) || y < 1450 || y > new Date().getFullYear() + 1)) {
      return setError("That year doesn't look right.");
    }
    await logScan(`manual:${crypto.randomUUID()}`, {
      title: title.trim(),
      author: author.trim() || null,
      year: y,
      publisher: null,
    });
    onPicked(title.trim());
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="h-12 rounded-xl border border-line bg-surface font-medium disabled:opacity-40"
      >
        No barcode? Find the book by title
      </button>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Book without a barcode" className="fixed inset-0 z-30 flex flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Book without a barcode</h2>
          <button type="button" onClick={close} className="px-2 py-1 text-accent">
            Cancel
          </button>
        </div>

        <form onSubmit={byHand ? saveByHand : runSearch} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Author</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} className={field} />
          </label>
          {byHand ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Year <span className="font-normal text-muted">(optional)</span></span>
                <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className={field} />
              </label>
              <p className="text-sm text-muted">It&apos;ll be marked &ldquo;needs review&rdquo; so it can be checked later.</p>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <button type="submit" className="h-12 rounded-xl bg-accent font-medium text-accent-contrast">
                Log this book
              </button>
            </>
          ) : (
            <button
              type="submit"
              disabled={!online || search.state === "searching" || (!title.trim() && !author.trim())}
              className="h-12 rounded-xl bg-accent font-medium text-accent-contrast disabled:opacity-40"
            >
              {search.state === "searching" ? "Searching Finna…" : "Search Finna"}
            </button>
          )}
        </form>

        {!online && !byHand && (
          <p className="text-sm text-muted">No signal, so Finna can&apos;t be searched. You can enter the book by hand.</p>
        )}
        {search.state === "error" && <p role="alert" className="text-sm text-danger">{search.message}</p>}

        {search.state === "done" && !byHand && (
          search.choices.length > 0 ? (
            <ul aria-label="Matching editions" className="overflow-hidden rounded-xl border border-line bg-surface">
              {search.choices.map((c) => (
                <li key={c.finnaId} className="border-b border-line last:border-0">
                  <button type="button" onClick={() => void pick(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-line/50">
                    <BookCover src={c.coverUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium leading-snug">{c.title}</span>
                      <span className="block truncate text-sm text-muted">
                        {[c.author, c.year, c.publisher].filter(Boolean).join(" · ")}
                      </span>
                      {c.isbn13 && <span className="block font-mono text-xs text-muted">{keyLabel(c.isbn13)}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-accent">Log</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No printed editions found in Finna.</p>
          )
        )}

        {!byHand && (
          <button type="button" onClick={() => setByHand(true)} className="h-12 rounded-xl border border-line bg-surface font-medium">
            Not listed? Enter it by hand
          </button>
        )}
      </div>
    </div>
  );
}
