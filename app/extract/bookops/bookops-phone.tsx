"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraScanner } from "@/app/scan/_components/camera-scanner";
import { CameraIcon, CheckIcon } from "@/components/icons";
import type { BookOpsBook } from "@/lib/bookops-model";
import { claimCamera } from "@/lib/client/camera";
import { bookOps, BookOpsApiError, canvasOfFile, readBarcode, toJpeg } from "@/lib/client/bookops";
import { formatIsbn } from "@/lib/isbn";
import { LoginForm } from "../_components/login-form";

/** How often the "Needs photos" list checks for news while it's on screen. */
const REFRESH_MS = 4000;
/**
 * After a listing's photos are sent the scanner comes back on — often still
 * pointing at that same book. Its barcode is ignored this long, so it isn't
 * added again by accident.
 */
const QUIET_AFTER_PHOTOS_MS = 15_000;
/** Event handlers only (the lint can't tell these handlers from rendering). */
const quietUntil = () => Date.now() + QUIET_AFTER_PHOTOS_MS;

/** One book sent from this phone by scanning (or by its back cover), as shown in its list. */
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

type Side = "front" | "back";
type Shot = { blob: Blob; url: string; canvas: HTMLCanvasElement };
/** Photos being taken for one listing: the sides it lacks, and those taken so far. */
type Shooting = {
  id: string;
  title: string;
  isbn13: string | null;
  /** No ISBN yet: the barcode in the back photo can give it. */
  needsIsbn: boolean;
  need: Side[];
  shots: Partial<Record<Side, Shot>>;
  state: "taking" | "sending" | "failed";
  error?: string;
};

const SIDE_NAME: Record<Side, string> = { front: "Front cover", back: "Back cover" };
const nameOf = (b: Pick<BookOpsBook, "title" | "isbn13">) => b.title?.trim() || (b.isbn13 ? `ISBN ${formatIsbn(b.isbn13)}` : "Untitled book");
/** The sides a listing lacks, back cover first: that is where the barcode is, so it is already facing up after scanning. */
const missing = (b: BookOpsBook): Side[] => [...(b.backPhoto ? [] : (["back"] as const)), ...(b.frontPhoto ? [] : (["front"] as const))];

/**
 * BookOps on a phone (docs/spec-corrections.md §27): the phone does what the
 * computer can't, with its good camera — while the price, condition and the
 * rest are set on the computer.
 *
 * - **Scan**: each barcode is a new listing in the computer's To do list; its
 *   title arrives from the book databases within seconds.
 * - **Photos**: every listing still lacking its front or back photo is under
 *   "Needs photos" (scanned here, typed on the computer, or from a hand-held
 *   reader). Tap one: the phone's own camera app takes the front cover, then
 *   the back; they go to that listing, and the AI reads the back-cover text.
 * - **No barcode**: photograph the back cover — the AI reads the printed ISBN,
 *   and the photo is kept as the listing's back cover.
 */
export function BookOpsPhone() {
  const noBarcodeRef = useRef<HTMLInputElement>(null);
  const frontInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);
  const inputRef = { front: frontInput, back: backInput };
  /** Hands the camera back to the scanner once the phone's camera app is done. */
  const releaseRef = useRef<(() => void) | null>(null);
  const [login, setLogin] = useState<"loading" | "needed" | "ok" | "offline">("loading");
  const [sent, setSent] = useState<Sent[]>([]);
  const [books, setBooks] = useState<BookOpsBook[]>([]);
  const [shooting, setShooting] = useState<Shooting | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  /** Listings whose photos were just sent from here: kept off "Needs photos" until the list catches up. */
  const [justSent, setJustSent] = useState<string[]>([]);
  /** The ISBN of the book just photographed, ignored by the scanner until `until`. */
  const quietRef = useRef<{ isbn: string; until: number } | null>(null);

  useEffect(() => {
    void fetch("/api/extract/login", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ loggedIn: boolean }>) : null))
      .then((s) => setLogin(s ? (s.loggedIn ? "ok" : "needed") : "offline"))
      .catch(() => setLogin("offline"));
  }, []);

  const load = useCallback(async () => {
    try {
      setBooks(await bookOps.list());
    } catch (e) {
      if (e instanceof BookOpsApiError && e.loggedOut) setLogin("needed");
    }
  }, []);

  useEffect(() => {
    if (login !== "ok") return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [login, load]);

  const update = (id: string, patch: Partial<Sent>) => setSent((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const fromBook = (b: BookOpsBook): Partial<Sent> => ({
    isbn13: b.isbn13,
    title: b.title,
    author: b.author,
    finished: b.lookupStatus !== "pending" && b.aiStatus !== "pending",
  });

  /** Sends one book; its title follows once the lookup (and the AI, for a photo) is done. */
  const send = useCallback(
    async (entry: Sent) => {
      update(entry.id, { state: "sending", error: undefined });
      try {
        const { book, sameIsbn } = await bookOps.add({ id: entry.id, isbn: entry.retry?.isbn, isbnSource: "barcode", back: entry.retry?.back });
        update(entry.id, { ...fromBook(book), sameIsbn, state: "sent", retry: undefined });
        void load();
        const done = await bookOps.process(book.id).catch(() => null);
        if (done) {
          update(entry.id, fromBook(done));
          void load();
        }
      } catch (e) {
        if (e instanceof BookOpsApiError && e.loggedOut) setLogin("needed");
        update(entry.id, { state: "failed", error: e instanceof Error ? e.message.replace(/\.$/, "") : "it failed" });
      }
    },
    [load],
  );

  const onIsbn = useCallback(
    (isbn13: string) => {
      const quiet = quietRef.current;
      if (quiet && quiet.isbn === isbn13 && Date.now() < quiet.until) return;
      const entry: Sent = { id: crypto.randomUUID(), how: "scan", isbn13, title: null, author: null, sameIsbn: 0, finished: false, state: "sending", retry: { isbn: isbn13 } };
      setSent((all) => [entry, ...all]);
      void send(entry);
    },
    [send],
  );

  /** The phone's own camera app (best focus and sharpness). The scanner lets go of the camera meanwhile. */
  const openCamera = (input: HTMLInputElement | null) => {
    if (!input) return;
    releaseRef.current?.();
    releaseRef.current = claimCamera();
    input.click();
  };
  const cameraDone = () => {
    releaseRef.current?.();
    releaseRef.current = null;
  };

  /** No barcode: the back cover's photo is the book — the AI reads its printed ISBN, and it's kept as the back cover. */
  const onNoBarcodePhoto = async (file: File | undefined) => {
    cameraDone();
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const canvas = await canvasOfFile(file);
      const [back, barcode] = await Promise.all([toJpeg(canvas), readBarcode(canvas)]);
      const entry: Sent = { id: crypto.randomUUID(), how: "photo", isbn13: barcode, title: null, author: null, sameIsbn: 0, finished: false, state: "sending", retry: { back, isbn: barcode ?? undefined } };
      setSent((all) => [entry, ...all]);
      void send(entry);
    } catch {
      setPhotoError("Couldn't open that photo. Try again.");
    } finally {
      setPhotoBusy(false);
      if (noBarcodeRef.current) noBarcodeRef.current.value = "";
    }
  };

  /** Photos for a listing: the camera app opens straight away for the first side it lacks. */
  const startPhotos = (book: Pick<BookOpsBook, "id" | "title" | "isbn13">, need: Side[]) => {
    if (!need.length) return;
    setShooting({ id: book.id, title: nameOf(book), isbn13: book.isbn13, needsIsbn: !book.isbn13, need, shots: {}, state: "taking" });
    openCamera(inputRef[need[0]].current);
  };

  const sendPhotos = async (s: Shooting) => {
    setShooting({ ...s, state: "sending", error: undefined });
    try {
      const isbn = s.needsIsbn && s.shots.back ? await readBarcode(s.shots.back.canvas) : null;
      await bookOps.attach(s.id, { front: s.shots.front?.blob, back: s.shots.back?.blob, isbn });
      const photographed = s.isbn13 ?? isbn;
      if (photographed) quietRef.current = { isbn: photographed, until: quietUntil() };
      Object.values(s.shots).forEach((x) => URL.revokeObjectURL(x.url));
      setJustSent((all) => [...all, s.id]);
      setShooting(null);
      void bookOps.process(s.id).then(() => load(), () => {});
      void load();
    } catch (e) {
      if (e instanceof BookOpsApiError && e.loggedOut) setLogin("needed");
      setShooting({ ...s, state: "failed", error: e instanceof Error ? e.message.replace(/\.$/, "") : "it failed" });
    }
  };

  const onSidePhoto = async (side: Side, file: File | undefined) => {
    cameraDone();
    const input = inputRef[side].current;
    if (!file || !shooting) {
      if (input) input.value = "";
      return;
    }
    try {
      const canvas = await canvasOfFile(file);
      const blob = await toJpeg(canvas);
      const before = shooting.shots[side];
      if (before) URL.revokeObjectURL(before.url);
      const next: Shooting = { ...shooting, shots: { ...shooting.shots, [side]: { blob, url: URL.createObjectURL(blob), canvas } } };
      if (next.need.every((x) => next.shots[x])) await sendPhotos(next);
      else setShooting(next);
    } catch {
      setShooting({ ...shooting, state: "failed", error: "Couldn't open that photo" });
    } finally {
      if (input) input.value = "";
    }
  };

  const cancelPhotos = () => {
    if (shooting) Object.values(shooting.shots).forEach((x) => URL.revokeObjectURL(x.url));
    setShooting(null);
  };

  // The camera app closed without a photo ("cancel" isn't in React's props): give the camera back to the scanner.
  useEffect(() => {
    const inputs = [noBarcodeRef.current, frontInput.current, backInput.current].filter((x): x is HTMLInputElement => Boolean(x));
    const done = () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };
    inputs.forEach((x) => x.addEventListener("cancel", done));
    return () => inputs.forEach((x) => x.removeEventListener("cancel", done));
  }, [login]);

  if (login === "loading") return <p className="text-muted">Loading…</p>;
  if (login === "offline") return <p className="text-muted">No connection. BookOps needs signal to send books to the computer.</p>;
  if (login === "needed") {
    return <LoginForm label="BookOps needs the access code" hint="The same code as AI reading. Asked once on this phone." onLoggedIn={() => setLogin("ok")} />;
  }

  const needs = books.filter((b) => b.status === "draft" && missing(b).length > 0 && !justSent.includes(b.id));
  const needsById = new Map(needs.map((b) => [b.id, b]));
  const button = "flex items-center justify-center gap-2 rounded-xl font-medium disabled:opacity-40";

  return (
    <>
      {/* The phone's camera app, one input per side (and one for a book without a barcode). */}
      {(["front", "back"] as const).map((side) => (
        <input
          key={side}
          ref={inputRef[side]}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={`${SIDE_NAME[side]} photo`}
          tabIndex={-1}
          onChange={(e) => void onSidePhoto(side, e.target.files?.[0])}
        />
      ))}

      {shooting ? (
        <section aria-label="Taking photos" className="flex flex-col gap-3 rounded-xl border-2 border-accent bg-surface p-3">
          <h2 className="text-base font-semibold">
            Photos for: <span className="font-normal">{shooting.title}</span>
          </h2>
          <ol className={`grid gap-2 ${shooting.need.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {shooting.need.map((side) => {
              const shot = shooting.shots[side];
              const next = !shot && shooting.need.find((x) => !shooting.shots[x]) === side;
              return (
                <li key={side}>
                  <button
                    type="button"
                    disabled={shooting.state === "sending"}
                    onClick={() => openCamera(inputRef[side].current)}
                    className={`${button} h-20 w-full flex-col gap-1 border text-sm ${next ? "border-accent bg-accent text-accent-contrast" : "border-line"}`}
                  >
                    {shot ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={shot.url} alt="" className="h-10 w-8 rounded object-cover" />
                        {SIDE_NAME[side]} ✓
                      </>
                    ) : (
                      <>
                        <CameraIcon className="size-6" />
                        {next && Object.keys(shooting.shots).length ? `Now the ${SIDE_NAME[side].toLowerCase()}` : SIDE_NAME[side]}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {shooting.state === "sending" && (
            <p role="status" className="text-center text-sm text-muted">
              Sending the photos…
            </p>
          )}
          {shooting.state === "failed" && (
            <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
              Not sent ({shooting.error}).
              {shooting.need.every((x) => shooting.shots[x]) && (
                <button type="button" onClick={() => void sendPhotos(shooting)} className={`${button} h-11 bg-accent text-accent-contrast`}>
                  Send again
                </button>
              )}
            </div>
          )}
          <button type="button" onClick={cancelPhotos} disabled={shooting.state === "sending"} className="h-10 text-sm text-muted">
            Cancel
          </button>
        </section>
      ) : (
        <p className="text-sm text-muted">
          Scan a book&apos;s barcode to add it to the To do list on the computer, then add its photos here. The price and the rest
          are set on the computer.
        </p>
      )}

      <CameraScanner disabled={Boolean(shooting)} autoStart onIsbn={onIsbn} />

      {sent.length > 0 && (
        <section aria-label="Sent to the computer" className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">Sent to the computer ({sent.filter((s) => s.state === "sent").length})</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {sent.map((s) => {
              const lacking = needsById.get(s.id);
              return (
                <li key={s.id} className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5 text-sm last:border-0">
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
                    {lacking && !shooting && (
                      <button
                        type="button"
                        onClick={() => startPhotos(lacking, missing(lacking))}
                        className="h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-accent-contrast"
                      >
                        Add photos now
                      </button>
                    )}
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
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Needs photos" className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold">Needs photos ({needs.length})</h2>
        {needs.length ? (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {needs.map((b) => {
              const lack = missing(b);
              return (
                <li key={b.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    disabled={Boolean(shooting)}
                    onClick={() => startPhotos(b, lack)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-line/50 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{nameOf(b)}</span>
                      <span className="block text-xs text-muted">{lack.length === 2 ? "Back and front cover" : `${SIDE_NAME[lack[0]]} still needed`}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent">
                      <CameraIcon className="size-5" />
                      Add photos
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">Every listing to do has its photos.</p>
        )}
      </section>

      <section aria-label="No barcode" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
        <input
          ref={noBarcodeRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Back cover photo, no barcode"
          tabIndex={-1}
          onChange={(e) => void onNoBarcodePhoto(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={photoBusy || Boolean(shooting)}
          onClick={() => openCamera(noBarcodeRef.current)}
          className={`${button} h-12 border border-line`}
        >
          <CameraIcon className="size-5" />
          {photoBusy ? "Preparing the photo…" : "No barcode? Photograph the back cover"}
        </button>
        <p className="text-xs text-muted">
          A new listing: the AI reads the ISBN printed on the back cover, and the photo is kept as its back cover.
        </p>
        {photoError && (
          <p role="alert" className="text-sm text-danger">
            {photoError}
          </p>
        )}
      </section>
    </>
  );
}
