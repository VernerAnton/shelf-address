"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "@/components/icons";
import { kvGet, kvSet } from "@/lib/client/kv";
import { readTextFromPhoto, warmOcr } from "@/lib/client/ocr";
import { textFileName, tidyText } from "@/lib/extract-text";

const TEXT_KEY = "extract:text";
/** Remembered so the screen knows without signal; the server has the final say. */
const LOGIN_KEY = "extract:login";
/** Below this (Tesseract's 0–100), warn that the text needs checking. */
const SHAKY = 70;
/** Photos go to the AI at most this big: plenty for small print, quick to upload. */
const AI_SIDE = 2000;

type Ai = { configured: boolean; loggedIn: boolean };

/** The photo, made smaller for the trip to the AI. */
async function forAi(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, AI_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Couldn't prepare the photo");
  return blob;
}

/** Why the AI didn't read it, and whether it was because the login is gone. */
class AiUnavailable extends Error {
  constructor(
    message: string,
    readonly loggedOut = false,
  ) {
    super(message);
  }
}

async function readWithAi(bitmap: ImageBitmap): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/extract", { method: "POST", body: await forAi(bitmap), headers: { "content-type": "image/jpeg" } });
  } catch {
    throw new AiUnavailable("no signal");
  }
  const body = (await response.json().catch(() => null)) as { text?: string; error?: string; kind?: string } | null;
  if (response.ok && typeof body?.text === "string") return body.text;
  throw new AiUnavailable(body?.error ?? `error ${response.status}`, body?.kind === "login");
}

/**
 * Extract (docs/spec-corrections.md §22): photograph a book's back-cover
 * text and get it to the computer, to make a new back cover for a copy that
 * lacks one. The text is read on the phone (Finnish and English), tidied,
 * shown for correcting, then shared as a .txt file — to OneDrive, email or
 * anything else in the phone's share menu — or copied.
 *
 * The text is kept on the phone as it's edited, so leaving for OneDrive (or
 * the phone closing the app while its camera is open) loses nothing.
 *
 * AI reading (§23): once this phone has logged in with the access code, the
 * photo is read by a vision model through the app's server — far better on
 * designed covers. Without the login, without signal, or if the AI fails,
 * the phone reads it instead, and says so.
 */
export function ExtractScreen() {
  const photoRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ kind: "warn" | "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<Ai>({ configured: false, loggedIn: false });
  const [code, setCode] = useState("");
  const [loginNote, setLoginNote] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    void Promise.all([kvGet<string>(TEXT_KEY), kvGet<Ai>(LOGIN_KEY)]).then(([saved, known]) => {
      setText(saved ?? "");
      if (known) setAi(known);
      setLoaded(true);
    });
    void fetch("/api/extract/login", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Ai>) : null))
      .then((state) => {
        if (!state) return;
        setAi(state);
        void kvSet(LOGIN_KEY, state);
      })
      .catch(() => {
        // No signal: go by what was known.
      });
    // The Finnish reading data (about 4 MB, once) for the phone reader, the backup.
    warmOcr("fin+eng");
  }, []);

  const rememberAi = (next: Ai) => {
    setAi(next);
    void kvSet(LOGIN_KEY, next);
  };

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginNote(null);
    try {
      const response = await fetch("/api/extract/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.ok) {
        rememberAi({ configured: true, loggedIn: true });
        setCode("");
      } else setLoginNote(body?.error ?? "Couldn't log in. Try again.");
    } catch {
      setLoginNote("No signal. Logging in needs a connection.");
    } finally {
      setLoggingIn(false);
    }
  };

  const logOut = async () => {
    await fetch("/api/extract/login", { method: "DELETE" }).catch(() => {});
    rememberAi({ ...ai, loggedIn: false });
  };

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
      let read: string | null = null;
      let why: string | null = null;
      if (ai.loggedIn) {
        try {
          read = await readWithAi(bitmap);
        } catch (e) {
          const reason = e instanceof AiUnavailable ? e : new AiUnavailable("it failed");
          if (reason.loggedOut) rememberAi({ ...ai, loggedIn: false });
          why = reason.loggedOut ? "this phone isn't logged in to AI reading any more" : reason.message.replace(/\.$/, "");
        }
      }
      let confidence = 100;
      if (read === null) {
        const phone = await readTextFromPhoto(bitmap);
        read = tidyText(phone.text);
        confidence = phone.confidence;
      }
      if (!read) {
        setNote({ kind: "error", text: "No text found in that photo. Try again closer, with the text filling the picture and good light." });
        return;
      }
      change(text.trim() ? `${text.trim()}\n\n${read}` : read);
      setNote(
        why
          ? { kind: "warn", text: `The AI couldn't read it (${why}), so the phone did — check the text carefully.` }
          : confidence < SHAKY
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

      {ai.configured && !ai.loggedIn && (
        <form onSubmit={(e) => void logIn(e)} aria-label="AI reading login" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <label htmlFor="extract-code" className="text-sm font-medium">
            AI reading — much better on designed covers — needs the access code
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
              disabled={!code.trim() || loggingIn}
              className="h-12 shrink-0 rounded-xl bg-accent px-4 font-medium text-accent-contrast disabled:opacity-40"
            >
              {loggingIn ? "…" : "Log in"}
            </button>
          </div>
          {loginNote && (
            <p role="alert" className="text-sm text-danger">
              {loginNote}
            </p>
          )}
          <p className="text-xs text-muted">Asked once on this phone. Without it, the phone reads the text itself (less accurate).</p>
        </form>
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
      {reading ? (
        <p className="-mt-2 text-center text-xs text-muted">
          {ai.loggedIn ? "The AI is reading it — usually a few seconds." : "This can take a little while on some phones."}
        </p>
      ) : ai.loggedIn ? (
        <p className="-mt-2 text-center text-xs text-muted">
          Read by AI ·{" "}
          <button type="button" onClick={() => void logOut()} className="underline">
            Log out
          </button>
        </p>
      ) : null}

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
          <button type="button" onClick={startOver} className={`${button} mt-2 bg-accent text-accent-contrast`}>
            Start over
          </button>
        </section>
      )}
    </>
  );
}
