"use client";

import { useState } from "react";
import { BookCover } from "@/components/book-cover";
import { keyLabel } from "@/lib/edition-key";
import { parseIsbn } from "@/lib/isbn";
import type { EditionChoice } from "@/lib/lookup/types";
import type { EditionDetails } from "@/lib/scan-queue";

/** What was chosen: an edition key, plus details when it has no ISBN. */
export type FoundEdition = {
  /** ISBN-13, finna:<id>, or "manual:new" for a book typed in by hand. */
  key: string;
  details?: EditionDetails;
  /** For confirmation messages. */
  label: string;
};

type Props = {
  heading: string;
  intro?: React.ReactNode;
  online: boolean;
  /** Offer "type the ISBN printed inside the book" first (for corrections). */
  allowIsbn?: boolean;
  onChoose: (found: FoundEdition) => void;
  onCancel: () => void;
};

type Search =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "done"; choices: EditionChoice[] }
  | { state: "error"; message: string };

const field = "h-12 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent";

/**
 * Full-screen "which book is this?" finder: an ISBN typed from the copyright
 * page (optional), a Finna title/author search listing one entry per printed
 * edition, or — no match, or no signal — details typed by hand, which are
 * marked "needs review". Used to log a book without a barcode, and to correct
 * a copy whose barcode belongs to another book.
 */
export function EditionFinder({ heading, intro, online, allowIsbn = false, onChoose, onCancel }: Props) {
  const [isbn, setIsbn] = useState("");
  const [isbnError, setIsbnError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [byHand, setByHand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useIsbn = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseIsbn(isbn);
    if (!parsed.ok) return setIsbnError(parsed.reason);
    onChoose({ key: parsed.isbn13, label: keyLabel(parsed.isbn13) });
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

  // A result with an ISBN is used as that ISBN, so it joins other copies of
  // the same edition; one without is keyed by its Finna record.
  const pick = (c: EditionChoice) =>
    onChoose(
      c.isbn13
        ? { key: c.isbn13, label: c.title }
        : {
            key: `finna:${c.finnaId}`,
            details: { title: c.title, author: c.author, year: c.year, publisher: c.publisher },
            label: c.title,
          },
    );

  const saveByHand = (e: React.FormEvent) => {
    e.preventDefault();
    const y = year.trim() ? Number(year) : null;
    if (!title.trim()) return setError("A title is needed.");
    if (y !== null && (!Number.isInteger(y) || y < 1450 || y > new Date().getFullYear() + 1)) {
      return setError("That year doesn't look right.");
    }
    onChoose({
      key: "manual:new",
      details: { title: title.trim(), author: author.trim() || null, year: y, publisher: null },
      label: title.trim(),
    });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={heading} className="fixed inset-0 z-30 flex flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 overflow-y-auto px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
          <button type="button" onClick={onCancel} className="px-2 py-1 text-accent">
            Cancel
          </button>
        </div>
        {intro}

        {allowIsbn && !byHand && (
          <form onSubmit={useIsbn} className="flex flex-col gap-1.5 border-b border-line pb-4">
            <label htmlFor="finder-isbn" className="text-sm font-medium">
              ISBN printed inside the book <span className="font-normal text-muted">(usually on the copyright page)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="finder-isbn"
                value={isbn}
                onChange={(e) => {
                  setIsbn(e.target.value);
                  setIsbnError(null);
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="978…"
                className={`${field} min-w-0 flex-1 font-mono`}
              />
              <button type="submit" disabled={!isbn.trim()} className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast disabled:opacity-40">
                Use
              </button>
            </div>
            {isbnError && <p role="alert" className="text-sm text-danger">{isbnError}</p>}
          </form>
        )}
        {allowIsbn && !byHand && <p className="-mb-1 text-sm font-medium">Or find it by title</p>}

        <form onSubmit={byHand ? saveByHand : runSearch} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} autoFocus={!allowIsbn} />
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
                Use these details
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

        {search.state === "done" && !byHand &&
          (search.choices.length > 0 ? (
            <ul aria-label="Matching editions" className="overflow-hidden rounded-xl border border-line bg-surface">
              {search.choices.map((c) => (
                <li key={c.finnaId} className="border-b border-line last:border-0">
                  <button type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-line/50">
                    <BookCover src={c.coverUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium leading-snug">{c.title}</span>
                      <span className="block truncate text-sm text-muted">
                        {[c.author, c.year, c.publisher].filter(Boolean).join(" · ")}
                      </span>
                      {c.isbn13 && <span className="block font-mono text-xs text-muted">{keyLabel(c.isbn13)}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-medium text-accent">Choose</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No printed editions found in Finna.</p>
          ))}

        {!byHand && (
          <button type="button" onClick={() => setByHand(true)} className="h-12 rounded-xl border border-line bg-surface font-medium">
            Not listed? Enter it by hand
          </button>
        )}
      </div>
    </div>
  );
}
