"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon } from "@/components/icons";
import { bookOps, BookOpsApiError, canvasOfFile, readBarcode, toJpeg } from "@/lib/client/bookops";
import { formatIsbn } from "@/lib/isbn";
import { LoginForm } from "../_components/login-form";

type Side = "front" | "back";
type Shot = { blob: Blob; url: string; canvas: HTMLCanvasElement };
type Sent = { id: string; text: string };

/**
 * BookOps on a phone (docs/spec-corrections.md §27): the phone as the camera.
 * Photograph a book's front and back cover with the phone's own camera app,
 * and the book appears in BookOps on the computer within seconds — where the
 * pricing is done. Kept simple on purpose: the work happens on the computer.
 */
export function BookOpsPhone() {
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  const [login, setLogin] = useState<"loading" | "needed" | "ok" | "offline">("loading");
  const [shots, setShots] = useState<Partial<Record<Side, Shot>>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  useEffect(() => {
    void fetch("/api/extract/login", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ loggedIn: boolean }>) : null))
      .then((s) => setLogin(s ? (s.loggedIn ? "ok" : "needed") : "offline"))
      .catch(() => setLogin("offline"));
  }, []);

  const send = async (front: Shot, back: Shot) => {
    setSending(true);
    setError(null);
    try {
      const isbn = await readBarcode(back.canvas);
      const book = await bookOps.add({ id: crypto.randomUUID(), front: front.blob, back: back.blob, isbn, isbnSource: "barcode" });
      // The reading is started from here; the computer picks it up if this page is left.
      void bookOps.process(book.id).catch(() => {});
      setSent((all) => [{ id: book.id, text: isbn ? `ISBN ${formatIsbn(isbn)}` : "no barcode found — the AI is looking for the ISBN" }, ...all]);
      URL.revokeObjectURL(front.url);
      URL.revokeObjectURL(back.url);
      setShots({});
    } catch (e) {
      if (e instanceof BookOpsApiError && e.loggedOut) setLogin("needed");
      setError(`Not sent (${e instanceof Error ? e.message.replace(/\.$/, "") : "it failed"}). The photos are still here — try again.`);
    } finally {
      setSending(false);
    }
  };

  const onPhoto = async (side: Side, file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const canvas = await canvasOfFile(file);
      const blob = await toJpeg(canvas);
      const shot = { blob, url: URL.createObjectURL(blob), canvas };
      const next = { ...shots, [side]: shot };
      if (shots[side]) URL.revokeObjectURL(shots[side].url);
      setShots(next);
      // Both covers: off it goes.
      if (next.front && next.back) await send(next.front, next.back);
    } catch {
      setError("Couldn't open that photo. Try again.");
    } finally {
      const input = side === "front" ? frontRef.current : backRef.current;
      if (input) input.value = "";
    }
  };

  if (login === "loading") return <p className="text-muted">Loading…</p>;
  if (login === "offline") return <p className="text-muted">No connection. BookOps needs signal to send the photos to the computer.</p>;
  if (login === "needed") {
    return <LoginForm label="BookOps needs the access code" hint="The same code as AI reading. Asked once on this phone." onLoggedIn={() => setLogin("ok")} />;
  }

  const button = "flex h-16 items-center gap-3 rounded-xl px-4 text-left text-lg font-medium disabled:opacity-40";
  const side = (which: Side, label: string, step: string) => {
    const shot = shots[which];
    const next = which === "front" ? !shots.front : Boolean(shots.front) && !shots.back;
    return (
      <>
        <input
          ref={which === "front" ? frontRef : backRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label={`${label} photo`}
          tabIndex={-1}
          onChange={(e) => void onPhoto(which, e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={sending}
          onClick={() => (which === "front" ? frontRef : backRef).current?.click()}
          className={`${button} ${next ? "bg-accent text-accent-contrast" : "border border-line bg-surface"}`}
        >
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
          ) : (
            <CameraIcon className="size-7 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className={`block text-xs font-normal ${next ? "" : "text-muted"}`}>{step}</span>
            {shot ? `${label} ✓ — tap to retake` : `Photograph the ${label.toLowerCase()}`}
          </span>
        </button>
      </>
    );
  };

  return (
    <>
      <p className="text-sm text-muted">
        Photograph a book&apos;s front and back cover. It appears in BookOps on the computer by itself, where it&apos;s priced and
        sent to the web store.
      </p>
      {side("front", "Front cover", "Step 1")}
      {side("back", "Back cover", "Step 2")}
      {sending && (
        <p role="status" className="text-center text-sm text-muted">
          Sending to the computer…
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3 text-sm text-danger">
          {error}
          {shots.front && shots.back && (
            <button type="button" onClick={() => void send(shots.front!, shots.back!)} className="h-11 rounded-lg bg-accent font-medium text-accent-contrast">
              Send again
            </button>
          )}
        </div>
      )}
      {sent.length > 0 && (
        <section aria-label="Sent to the computer" className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">Sent to the computer ({sent.length})</h2>
          <ul className="overflow-hidden rounded-xl border border-line bg-surface">
            {sent.map((s) => (
              <li key={s.id} className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-sm last:border-0">
                <CheckIcon className="size-4 shrink-0 text-accent" />
                <span className="min-w-0">Book sent · {s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
