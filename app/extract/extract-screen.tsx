"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "@/components/icons";
import { kvGet, kvSet } from "@/lib/client/kv";
import { readTextFromPhoto, warmOcr } from "@/lib/client/ocr";
import { textFileName, tidyText } from "@/lib/extract-text";

const TEXT_KEY = "extract:text";
/** Below this (Tesseract's 0–100), warn that the text needs checking. */
const SHAKY = 70;

/**
 * Extract (docs/spec-corrections.md §22): photograph a book's back-cover
 * text and get it to the computer, to make a new back cover for a copy that
 * lacks one. The text is read on the phone (Finnish and English), tidied,
 * shown for correcting, then shared as a .txt file — to OneDrive, email or
 * anything else in the phone's share menu — or copied.
 *
 * The text is kept on the phone as it's edited, so leaving for OneDrive (or
 * the phone closing the app while its camera is open) loses nothing.
 */
export function ExtractScreen() {
  const photoRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ kind: "warn" | "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void kvGet<string>(TEXT_KEY).then((saved) => {
      setText(saved ?? "");
      setLoaded(true);
    });
    // The Finnish reading data (about 4 MB, once) while the person lines up the book.
    warmOcr("fin+eng");
  }, []);

  const change = (next: string) => {
    setText(next);
    void kvSet(TEXT_KEY, next);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setNote(null);
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const { text: raw, confidence } = await readTextFromPhoto(bitmap);
      const read = tidyText(raw);
      if (!read) {
        setNote({ kind: "error", text: "No text found in that photo. Try again closer, with the text filling the picture and good light." });
        return;
      }
      change(text.trim() ? `${text.trim()}\n\n${read}` : read);
      setNote(
        confidence < SHAKY
          ? { kind: "warn", text: "Parts of this may be read wrong — check it before sharing. A sharper, flatter, better-lit photo helps." }
          : null,
      );
    } catch {
      setNote({
        kind: "error",
        text: navigator.onLine
          ? "Couldn't read that photo. Try again."
          : "Reading text needs signal the first time (a one-time download of about 4 MB). Try again where there's signal.",
      });
    } finally {
      bitmap?.close();
      setReading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const share = async () => {
    const body = text.trim();
    const file = new File([body + "\n"], textFileName(body, new Date()), { type: "text/plain" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: file.name });
      else if (navigator.share) await navigator.share({ text: body });
      else {
        // No share menu (a computer's browser): save the file instead.
        const url = URL.createObjectURL(file);
        const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") setNote({ kind: "error", text: "Couldn't share. Try Copy instead." });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote({ kind: "error", text: "Couldn't copy. Select the text and copy it by hand." });
    }
  };

  const startOver = () => {
    if (!window.confirm("Clear the text and start over?")) return;
    change("");
    setNote(null);
  };

  if (!loaded) return <p className="text-muted">Loading…</p>;

  const has = text.trim().length > 0;
  const words = has ? text.trim().split(/\s+/).length : 0;
  const button = "flex h-12 items-center justify-center rounded-xl font-medium disabled:opacity-40";

  return (
    <>
      {!has && (
        <p className="text-sm text-muted">
          Photograph a book&apos;s back-cover text to get it onto the computer — for making a new back cover. Fill the picture with
          the text, hold the book flat, and use good light.
        </p>
      )}

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Text photo"
        tabIndex={-1}
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={reading}
        onClick={() => photoRef.current?.click()}
        className={`${button} h-14 gap-2 ${has ? "border border-line bg-surface" : "bg-accent text-lg text-accent-contrast"}`}
      >
        <CameraIcon className="size-6" />
        {reading ? "Reading the text…" : has ? "Add another photo" : "Take a photo of the text"}
      </button>
      {reading && <p className="-mt-2 text-center text-xs text-muted">This can take a little while on some phones.</p>}

      {note && (
        <p
          role="status"
          className={`rounded-lg border p-2 text-sm ${
            note.kind === "error" ? "border-danger/40 text-danger" : "border-warn-line bg-warn-bg text-warn-text"
          }`}
        >
          {note.text}
        </p>
      )}

      {has && (
        <section aria-label="Extracted text" className="flex flex-col gap-3">
          <label htmlFor="extract-text" className="flex items-baseline justify-between text-sm font-medium">
            Text — check and correct it
            <span className="text-xs font-normal text-muted">{words} words</span>
          </label>
          <textarea
            id="extract-text"
            value={text}
            onChange={(e) => change(e.target.value)}
            rows={12}
            lang="fi"
            spellCheck
            className="min-h-60 w-full rounded-xl border border-line bg-surface p-3 text-base leading-relaxed outline-none focus:border-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void share()} className={`${button} bg-accent text-accent-contrast`}>
              Share
            </button>
            <button type="button" onClick={() => void copy()} className={`${button} border border-line bg-surface`}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Share sends it as a text file: choose OneDrive to have it on the computer, or email, or anything else.
          </p>
          <button type="button" onClick={startOver} className="h-10 self-center px-4 text-sm text-muted">
            Start over
          </button>
        </section>
      )}
    </>
  );
}
