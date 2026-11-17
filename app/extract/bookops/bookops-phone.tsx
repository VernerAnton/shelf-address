"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraScanner } from "@/app/scan/_components/camera-scanner";
import { CameraIcon, CheckIcon } from "@/components/icons";
import type { BookOpsBook } from "@/lib/bookops-model";
import { bookOps, BookOpsApiError, canvasOfFile, readBarcode, toJpeg } from "@/lib/client/bookops";
import { formatIsbn } from "@/lib/isbn";
import { LoginForm } from "../_components/login-form";

/** One book sent from this phone, as shown in its list. */
type Sent = {
  /** Made here, so sending it again can't make two books. */
  id: string;
  how: "scan" | "photo";
  isbn13: string | null;
  title: string | null;
  author: string | null;
  /** Other books still to do with the same ISBN, when it was sent. */
  sameIsbn: number;
  /** The lookup and the AI are done (with or without a title). */
  finished: boolean;
  state: "sending" | "sent" | "failed";
  error?: string;
  /** For "Send again" after a failure. */
  retry?: { isbn?: string; back?: Blob };
};

/**
 * BookOps on a phone (docs/spec-corrections.md §27): what the computer can't
 * do — the phone is the hand-held ISBN scanner until there is one. Each
 * barcode scanned is a new book in the computer's To do list; its title
 * arrives from the book databases within seconds, here and there. A book
 * without a barcode: photograph its back cover — the AI reads the printed
 * ISBN, and the photo is kept as the book's back cover. Everything else
 * (front photo, price, condition) is done on the computer.
 */
export function BookOpsPhone() {
  const backRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState<"loading" | "needed" | "ok" | "offline">("loading");
  const [sent, setSent] = useState<Sent[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/extract/login", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ loggedIn: boolean }>) : null))
      .then((s) => setLogin(s ? (s.loggedIn ? "ok" : "needed") : "offline"))
      .catch(() => setLogin("offline"));
  }, []);

  const update = (id: string, patch: Partial<Sent>) => setSent((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const fromBook = (b: BookOpsBook): Partial<Sent> => ({
    isbn13: b.isbn13,
    title: b.title,
    author: b.author,
    finished: b.lookupStatus !== "pending" && b.aiStatus !== "pending",
  });

  /** Sends one book; its title follows once the lookup (and the AI, for a photo) is done. */
  const send = useCallback(async (entry: Sent) => {
    update(entry.id, { state: "sending", error: undefined });
    try {
      const { book, sameIsbn } = await bookOps.add({
        id: entry.id,
        isbn: entry.retry?.isbn,
        isbnSource: "barcode",
        back: entry.retry?.back,
      });
      update(entry.id, { ...fromBook(book), sameIsbn, state: "sent", retry: undefined });
      const done = await bookOps.process(book.id).catch(() => null);
      if (done) update(entry.id, fromBook(done));
    } catch (e) {
      if (e instanceof BookOpsApiError && e.loggedOut) setLogin("needed");
      update(entry.id, { state: "failed", error: e instanceof Error ? e.message.replace(/\.$/, "") : "it failed" });
    }
  }, []);

  const onIsbn = useCallback(
    (isbn13: string) => {
      const entry: Sent = { id: crypto.randomUUID(), how: "scan", isbn13, title: null, author: null, sameIsbn: 0, finished: false, state: "sending", retry: { isbn: isbn13 } };
      setSent((all) => [entry, ...all]);
      void send(entry);
    },
    [send],
  );

  /** No barcode: the back cover's photo is the book — the AI reads its printed ISBN, and it's kept as the back cover. */
  const onBackPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const canvas = await canvasOfFile(file);
      const [back, barcode] = await Promise.all([toJpeg(canvas), readBarcode(canvas)]);
      const entry: Sent = {
        id: crypto.randomUUID(),
        how: "photo",
        isbn13: barcode,
        title: null,
        author: null,
        sameIsbn: 0,
        finished: false,
        state: "sending",
        retry: { back, isbn: barcode ?? undefined },
      };
      setSent((all) => [entry, ...all]);
      void send(entry);
    } catch {
      setPhotoError("Couldn't open that photo. Try again.");
    } finally {
      setPhotoBusy(false);
      if (backRef.current) backRef.current.value = "";
    }
  };

  if (login === "loading") return <p className="text-muted">Loading…</p>;
  if (login === "offline") return <p className="text-muted">No connection. BookOps needs signal to send books to the computer.</p>;
  if (login === "needed") {
    return <LoginForm label="BookOps needs the access code" hint="The same code as AI reading. Asked once on this phone." onLoggedIn={() => setLogin("ok")} />;
  }

  return (
    <>
      <p className="text-sm text-muted">
        Scan a book&apos;s barcode and it&apos;s added to the To do list in BookOps on the computer, where it&apos;s photographed,
        priced and sent to the web store.
      </p>

      <CameraScanner disabled={false} autoStart onIsbn={onIsbn} />

      <section aria-label="No barcode" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
        <input
          ref={backRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Back cover photo"
          tabIndex={-1}
          onChange={(e) => void onBackPhoto(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={photoBusy}
          onClick={() => backRef.current?.click()}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-medium disabled:opacity-40"
        >
          <CameraIcon className="size-5" />
          {photoBusy ? "Preparing the photo…" : "No barcode? Photograph the back cover"}
        </button>
        <p className="text-xs text-muted">
          The AI reads the ISBN printed on it, and the photo becomes the book&apos;s back cover — no need to take it again on the
          computer.
        </p>
        {photoError && (
          <p role="alert" className="text-sm text-danger">
            {photoError}
          </p>
        )}
      </section>

      {sent.length > 0 && (
        <section aria-label="Sent to the computer" className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">Sent to the computer ({sent.filter((s) => s.state === "sent").length})</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {sent.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 border-b border-line px-3 py-2.5 text-sm last:border-0">
                <span className="flex items-start gap-2">
                  {s.state === "sent" ? (
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                  ) : (
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${s.state === "failed" ? "bg-danger" : "animate-pulse bg-accent"}`} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {s.title?.trim() ||
                        (s.state === "failed"
                          ? "Not sent"
                          : s.finished
                            ? "No title found — add it on the computer"
                            : s.how === "photo"
                            ? "Back cover — the AI is reading the ISBN…"
                            : "Looking up the title…")}
                    </span>
                    <span className="block text-xs text-muted">
                      {s.isbn13 ? `ISBN ${formatIsbn(s.isbn13)}` : s.how === "photo" ? "Photographed back cover" : ""}
                      {s.author ? ` · ${s.author}` : ""}
                    </span>
                  </span>
                </span>
                {s.state === "sent" && s.sameIsbn > 0 && (
                  <span role="status" className="rounded-md border border-warn-line bg-warn-bg px-2 py-1 text-xs text-warn-text">
                    Already in the queue — added another copy. Delete it on the computer if that was a double scan.
                  </span>
                )}
                {s.state === "failed" && (
                  <span role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
                    Not sent ({s.error}).
                    <button type="button" onClick={() => void send(s)} className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-contrast">
                      Send again
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
