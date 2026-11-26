"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon } from "@/components/icons";
import Link from "next/link";
import { kvGet, kvSet } from "@/lib/client/kv";
import { queueCover, queueText, syncCovers, syncTexts, type CoverResult, type SyncResult } from "@/lib/client/saved-texts";
import { readTextFromPhoto, warmOcr } from "@/lib/client/ocr";
import { logPhoto } from "@/lib/client/photo-log";
import type { AiDetails } from "@/lib/extract-ai";
import { AI_MODELS, isAllowedModel, modelLabel } from "@/lib/ai-models";
import { tidyText } from "@/lib/extract-text";
import { LoginForm } from "./_components/login-form";

const TEXT_KEY = "extract:text";
/** Remembered so the screen knows without signal; the server has the final say. */
const LOGIN_KEY = "extract:login";
/** The saved text the screen is working on (§24): its id, when it was started, how it was read. */
const CURRENT_KEY = "extract:current";
type Current = { id: string; createdAt: string; source: "ai" | "phone"; cover?: CoverResult };
/**
 * Every text this phone has read, kept on the phone for 7 days (§28) so Start
 * over never loses one — even on a phone that isn't logged in.
 */
const HISTORY_KEY = "extract:history";
type Earlier = { id: string; text: string; createdAt: string; updatedAt: string; source: "ai" | "phone"; cover?: CoverResult };
const HISTORY_DAYS = 7;
/** Front covers go to the computer at most this big (§28). */
const COVER_SIDE = 1600;
/** How long typing pauses before a correction is saved. */
const SAVE_AFTER_MS = 1000;
/** Below this (Tesseract's 0–100), warn that the text needs checking. */
const SHAKY = 70;
/** Photos go to the AI at most this big: plenty for small print, quick to upload. */
const AI_SIDE = 2000;

type Ai = { configured: boolean; loggedIn: boolean };

/**
 * The last photo read and what came of it, kept on the phone until Start over
 * so a bad reading can be reported (§27), even after the app was closed.
 */
const LAST_KEY = "extract:last";
type LastRead = {
  takenAt: string;
  /** The photo as sent to the AI (made smaller), and a thumbnail for the log. */
  photo: Blob | null;
  thumb: Blob | null;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  readBy: "ai" | "phone";
  /** Exactly what came back, before anyone corrected it. */
  reply: string;
  details: AiDetails | null;
  /** Why the AI didn't read it, when the phone did. */
  why: string | null;
  confidence: number | null;
  ms: number;
};

/** The model stopped because it ran out of room: the end is missing. */
const stoppedEarly = (d: AiDetails | null) => d?.finishReason === "length";

/** The front cover, made 1600 px on its long side for the computer. */
async function forCover(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, COVER_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("Couldn't prepare the photo");
    return blob;
  } finally {
    bitmap.close();
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A small copy for the photo log's list. */
async function thumbnail(bitmap: ImageBitmap): Promise<Blob | null> {
  const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
  canvas.width = canvas.height = 0;
  return blob;
}

/** The report's text for the photo log: the note, how the reading went, and the reply. */
function reportText(last: LastRead, note: string): string {
  const d = last.details;
  const n = (v: number | null) => (v == null ? "?" : v.toLocaleString("en-GB"));
  const lines = [
    `Note: ${note || "(none)"}`,
    last.readBy === "ai" && d
      ? [
          `Read by: AI (${d.model})`,
          `Stopped because: ${d.finishReason ?? "not said"}${stoppedEarly(d) ? " — ran out of room, the end is missing" : ""}`,
          `Tokens: photo and instructions ${n(d.promptTokens)}, answer ${n(d.answerTokens)} of at most ${n(d.maxTokens)}${d.thinkingTokens != null ? ` (thinking ${n(d.thinkingTokens)})` : ""}`,
          `AI took: ${(d.ms / 1000).toFixed(1)} s${d.provider ? `, served by ${d.provider}` : ""}${d.thinking ? `, thinking: ${d.thinking}` : ""}`,
        ].join("\n")
      : `Read by: the phone${last.why ? ` (the AI couldn't: ${last.why})` : ""}, confidence ${last.confidence ?? "?"}`,
    `Photo: as sent to the AI${last.photo ? "" : " (couldn't be kept)"}; the original was ${last.width}×${last.height}`,
    "",
    "— What came back —",
    last.reply || "(nothing)",
  ];
  return lines.join("\n");
}

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

type AiAnswer = { text: string; details: AiDetails | null };

/** Longest the phone waits for the AI (the server itself gives up at 60 s). */
const AI_WAIT_MS = 90_000;
/** After this long, the phone also asks the server whether the answer is there already. */
const RECOVER_AFTER_MS = 5_000;
const RECOVER_EVERY_MS = 3_000;

/** The answer for a reading, if the server has it (it keeps every one: §28). */
async function fetchReading(readingId: string): Promise<AiAnswer | null> {
  try {
    const response = await fetch(`/api/extract/readings/${readingId}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as AiAnswer;
    return typeof body.text === "string" ? { text: body.text, details: body.details ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Reads the photo with the AI. The answer can get lost on its way back: a
 * phone puts the page to sleep while the camera is open (a front cover taken
 * during the reading, V30), and the reply arriving meanwhile may be dropped,
 * leaving "Reading the text…" for good. So each reading has an id the server
 * keeps its answer under, and after a few seconds — and on coming back to the
 * app — the phone also asks for it there (V31). Whichever comes first wins.
 */
/** The AI model this phone reads with (V33.4): "" for the app's default. Kept per phone. */
const MODEL_KEY = "extract:model";
function chosenModel(): string {
  try {
    const m = localStorage.getItem(MODEL_KEY) ?? "";
    return isAllowedModel(m) ? m : "";
  } catch {
    return "";
  }
}

async function readWithAi(jpeg: Blob, textId: string, model: string): Promise<AiAnswer> {
  const readingId = crypto.randomUUID();
  const controller = new AbortController();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let done = false;
  let onVisible = () => {};
  const sent = (async (): Promise<AiAnswer> => {
    let response: Response;
    try {
      // The text's id: the server keeps the photo and answer with it, for reports from the computer (§28).
      response = await fetch("/api/extract", {
        method: "POST",
        body: jpeg,
        headers: { "content-type": "image/jpeg", "x-text-id": textId, "x-reading-id": readingId, ...(model && { "x-model": model }) },
        signal: controller.signal,
      });
    } catch {
      // Cut off: perhaps the answer is on the server all the same.
      await new Promise((r) => setTimeout(r, 1000));
      const kept = await fetchReading(readingId);
      if (kept) return kept;
      throw new AiUnavailable("no signal");
    }
    const body = (await response.json().catch(() => null)) as { text?: string; details?: AiDetails; error?: string; kind?: string } | null;
    if (response.ok && typeof body?.text === "string") return { text: body.text, details: body.details ?? null };
    throw new AiUnavailable(body?.error ?? `error ${response.status}`, body?.kind === "login");
  })();
  const recovered = new Promise<AiAnswer>((resolve) => {
    let asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      const kept = await fetchReading(readingId);
      asking = false;
      if (kept) resolve(kept);
    };
    onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    const again = () => {
      if (done) return;
      void ask();
      timers.push(setTimeout(again, RECOVER_EVERY_MS));
    };
    timers.push(setTimeout(again, RECOVER_AFTER_MS));
  });
  const tooLong = new Promise<never>((_, reject) => {
    timers.push(setTimeout(() => reject(new AiUnavailable("the AI's answer never arrived")), AI_WAIT_MS));
  });
  try {
    return await Promise.race([sent, recovered, tooLong]);
  } finally {
    done = true;
    timers.forEach(clearTimeout);
    document.removeEventListener("visibilitychange", onVisible);
    controller.abort();
  }
}

/**
 * Extract (docs/spec-corrections.md §22): photograph a book's back-cover
 * text and get it to the computer, to make a new back cover for a copy that
 * lacks one. The text is read, tidied and shown for correcting.
 *
 * The text is kept on the phone as it's edited, so the phone closing the app
 * while its camera is open loses nothing.
 *
 * AI reading (§23): once this phone has logged in with the access code, the
 * photo is read by a vision model through the app's server — far better on
 * designed covers. Without the login, without signal, or if the AI fails,
 * the phone reads it instead, and says so.
 *
 * Saved texts (§24): on a logged-in phone, each text — and every correction —
 * is saved to the server by itself, so it's on the computer under Saved texts
 * within seconds. Without signal it waits.
 *
 * Since V28 (§28): no Share or Copy (Saved texts does that job); a big red
 * Report button; Start over goes straight to the camera for the next book; a
 * front cover photo goes with the text to the computer; and the phone keeps
 * its own texts for 7 days under "Earlier texts on this phone".
 */
export function ExtractScreen() {
  const photoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  // Read once; the screen shows "Loading…" until the phone's own data is in, so no mismatch with the server's render.
  const [model, setModel] = useState(chosenModel);
  // The stopwatch while a photo is read (V33.1): when it started, and the time now, ticking.
  const [readingSince, setReadingSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [note, setNote] = useState<{ kind: "warn" | "ok" | "error"; text: string } | null>(null);
  const [ai, setAi] = useState<Ai>({ configured: false, loggedIn: false });
  const [save, setSave] = useState<SyncResult | "saving" | null>(null);
  // "held": taken while the back text was still being read; it goes up once the text is saved (V30).
  const [cover, setCover] = useState<CoverResult | "saving" | "held" | null>(null);
  const coverHeld = useRef(false);
  const readingNow = useRef(false);
  const [last, setLast] = useState<LastRead | null>(null);
  const [report, setReport] = useState<"closed" | "open" | "sending" | "sent">("closed");
  const [reportNote, setReportNote] = useState("");
  const [earlier, setEarlier] = useState<Earlier[]>([]);
  const [showEarlier, setShowEarlier] = useState(false);
  const current = useRef<Current | null>(null);
  const pendingSave = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);

  useEffect(() => {
    void Promise.all([
      kvGet<string>(TEXT_KEY),
      kvGet<Ai>(LOGIN_KEY),
      kvGet<Current | null>(CURRENT_KEY),
      kvGet<LastRead | null>(LAST_KEY),
      kvGet<Earlier[]>(HISTORY_KEY),
    ]).then(([saved, known, cur, lastRead, history]) => {
      setText(saved ?? "");
      if (known) setAi(known);
      setLast(lastRead ?? null);
      current.current = cur ?? null;
      setCover(cur?.cover ?? null);
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 24 * 3600 * 1000).toISOString();
      const kept = (history ?? []).filter((e) => e.updatedAt >= cutoff);
      setEarlier(kept);
      if (kept.length !== (history ?? []).length) void kvSet(HISTORY_KEY, kept);
      setLoaded(true);
    });
    void fetch("/api/extract/login", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Ai>) : null))
      .then(async (state) => {
        if (!state) return;
        setAi(state);
        void kvSet(LOGIN_KEY, state);
        // Anything left from before (no signal then) goes up now.
        if (state.loggedIn) {
          const result = await syncTexts();
          if (current.current) setSave(result);
          const covers = await syncCovers(current.current?.id);
          if (current.current?.cover === "waiting" && covers === "saved") {
            current.current = { ...current.current, cover: "saved" };
            void kvSet(CURRENT_KEY, current.current);
            setCover("saved");
          }
        }
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

  const logOut = async () => {
    await fetch("/api/extract/login", { method: "DELETE" }).catch(() => {});
    rememberAi({ ...ai, loggedIn: false });
    setSave(null);
  };

  /** The text being worked on: its id is made when its first photo is taken. */
  const ensureCurrent = (readBy: "ai" | "phone" | null): Current => {
    const before = current.current;
    // Any part read by the phone reader marks the text as worth checking.
    const cur: Current = before
      ? { ...before, source: readBy === "phone" ? "phone" : before.source }
      : { id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: readBy ?? "ai" };
    current.current = cur;
    void kvSet(CURRENT_KEY, cur);
    return cur;
  };

  const rememberCover = (state: CoverResult) => {
    setCover(state);
    if (current.current) {
      current.current = { ...current.current, cover: state };
      void kvSet(CURRENT_KEY, current.current);
    }
  };

  /** Sends the text to Saved texts (logged-in phones only), now or after typing pauses. */
  const saveSoon = (next: string, readBy: "ai" | "phone" | null, delay: number) => {
    if (!next.trim()) return;
    const cur = ensureCurrent(readBy);
    if (!ai.loggedIn) return;
    if (pendingSave.current) clearTimeout(pendingSave.current.timer);
    const now = new Date().toISOString();
    setSave("saving");
    const run = () => {
      pendingSave.current = null;
      void queueText({ id: cur.id, createdAt: cur.createdAt, source: cur.source, text: next.trim(), updatedAt: now })
        .then(syncTexts)
        .then((result) => {
          setSave(result);
          if (result === "loggedout") rememberAi({ ...ai, loggedIn: false });
          // A front cover taken while the AI was reading follows the text up now.
          else if (coverHeld.current) {
            coverHeld.current = false;
            setCover("saving");
            void syncCovers(cur.id).then(rememberCover);
          }
        });
    };
    pendingSave.current = { timer: setTimeout(run, delay), run };
  };

  // Leaving the app (for the camera…): save a pending correction now.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && pendingSave.current) {
        clearTimeout(pendingSave.current.timer);
        pendingSave.current.run();
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  // The stopwatch ticks while a photo is read.
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [reading]);

  const change = (next: string, readBy: "ai" | "phone" | null = null) => {
    setText(next);
    void kvSet(TEXT_KEY, next);
    saveSoon(next, readBy, readBy ? 0 : SAVE_AFTER_MS);
  };

  const remember = (next: LastRead | null) => {
    setLast(next);
    setReport("closed");
    setReportNote("");
    void kvSet(LAST_KEY, next).catch(() => {});
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    readingNow.current = true;
    const since = Date.now();
    setReadingSince(since);
    setNow(since);
    setReading(true);
    setNote(null);
    const started = Date.now();
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      // The photo as the AI gets it, also kept for a problem report.
      const jpeg = await forAi(bitmap).catch(() => null);
      let read: string | null = null;
      let details: AiDetails | null = null;
      let why: string | null = null;
      if (ai.loggedIn) {
        try {
          if (!jpeg) throw new AiUnavailable("the photo couldn't be prepared");
          ({ text: read, details } = await readWithAi(jpeg, ensureCurrent(null).id, model));
        } catch (e) {
          const reason = e instanceof AiUnavailable ? e : new AiUnavailable("it failed");
          if (reason.loggedOut) rememberAi({ ...ai, loggedIn: false });
          why = reason.loggedOut ? "this phone isn't logged in any more" : reason.message.replace(/\.$/, "");
        }
      }
      let confidence: number | null = null;
      let readBy: "ai" | "phone" = "ai";
      if (read === null) {
        readBy = "phone";
        const phone = await readTextFromPhoto(bitmap);
        read = tidyText(phone.text);
        confidence = phone.confidence;
      }
      remember({
        takenAt: new Date(started).toISOString(),
        photo: jpeg,
        thumb: await thumbnail(bitmap).catch(() => null),
        width: bitmap.width,
        height: bitmap.height,
        bytes: file.size,
        mime: file.type,
        readBy,
        reply: read,
        details,
        why,
        confidence,
        ms: Date.now() - started,
      });
      const early = stoppedEarly(details);
      if (!read) {
        setNote({
          kind: "error",
          text: early
            ? "The AI ran out of room before writing anything. Try again, and if it keeps happening, report it below."
            : "No text found in that photo. Try again closer, with the text filling the picture and good light.",
        });
        return;
      }
      change(text.trim() ? `${text.trim()}\n\n${read}` : read, readBy);
      setNote(
        early
          ? { kind: "warn", text: "The AI stopped early — the end of the text may be missing. Take another photo of the rest." }
          : why
            ? { kind: "warn", text: `The AI couldn't read it (${why}), so the phone did — check the text carefully.` }
            : confidence !== null && confidence < SHAKY
              ? { kind: "warn", text: "Parts of this may be read wrong — check it before using it. A sharper, flatter, better-lit photo helps." }
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
      readingNow.current = false;
      setReading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  /** The book's front cover, to the computer with this text (§28). The camera app already offers a retake. */
  const onCover = async (file: File | undefined) => {
    if (!file) return;
    // While the first photo is still being read the text may not have its id yet: it gets it here.
    const cur = current.current ?? ensureCurrent(null);
    setCover("saving");
    try {
      await queueCover(cur.id, await forCover(file));
      // Taken while the AI reads the back (V30): it waits for the text, which the server needs first.
      if (readingNow.current || !text.trim()) {
        coverHeld.current = true;
        setCover("held");
        return;
      }
      // Make sure the text itself is on its way first (it may still be waiting to be typed into).
      if (pendingSave.current) {
        clearTimeout(pendingSave.current.timer);
        pendingSave.current.run();
      }
      const result = await syncCovers(cur.id);
      if (result === "loggedout") rememberAi({ ...ai, loggedIn: false });
      rememberCover(result);
    } catch {
      setCover(null);
      setNote({ kind: "error", text: "Couldn't use that photo of the front cover. Try again." });
    } finally {
      if (coverRef.current) coverRef.current.value = "";
    }
  };

  /** Sends the last photo, what came back, the text now and the note to the Photo log (§27). */
  const sendReport = async () => {
    setReport("sending");
    const said = reportNote.trim();
    const now = text.trim();
    try {
      await logPhoto(
        {
          takenAt: last?.takenAt ?? new Date().toISOString(),
          outcome: "error",
          isbns: [],
          error: said ? `Reported: ${said}` : "Reported (no note)",
          ocrText: [
            last ? reportText(last, said) : `Note: ${said || "(none)"}\n(The photo isn't on this phone any more.)`,
            "",
            "— The text now —",
            now || "(empty)",
          ].join("\n"),
          durationMs: last?.ms ?? null,
          width: last?.width ?? null,
          height: last?.height ?? null,
          bytes: last?.bytes ?? null,
          mime: last?.mime ?? null,
        },
        last?.photo ?? null,
        last?.thumb ?? null,
        { always: true },
      );
      setReport("sent");
    } catch {
      setReport("open");
      setNote({ kind: "error", text: "Couldn't save the report on this phone. Try again." });
    }
  };

  /** Puts the text on screen away into Earlier texts (if there is one), and clears the screen. */
  const putAway = (): Earlier[] => {
    if (pendingSave.current) {
      clearTimeout(pendingSave.current.timer);
      pendingSave.current.run();
    }
    let list = earlier;
    const cur = current.current;
    if (text.trim()) {
      const entry: Earlier = {
        id: cur?.id ?? crypto.randomUUID(),
        text: text.trim(),
        createdAt: cur?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: cur?.source ?? "ai",
        cover: cur?.cover,
      };
      list = [entry, ...earlier.filter((e) => e.id !== entry.id)];
    }
    current.current = null;
    coverHeld.current = false;
    void kvSet(CURRENT_KEY, null);
    setText("");
    void kvSet(TEXT_KEY, "");
    setNote(null);
    setSave(null);
    setCover(null);
    remember(null);
    return list;
  };

  const keepEarlier = (list: Earlier[]) => {
    setEarlier(list);
    void kvSet(HISTORY_KEY, list);
  };

  /** Start over: no question — the text is kept (Saved texts, and on this phone); straight to the camera. */
  const startOver = () => {
    keepEarlier(putAway());
    setShowEarlier(false);
    photoRef.current?.click();
  };

  /** Brings an earlier text back on screen, to correct or report it. */
  const openEarlier = (e: Earlier) => {
    const list = putAway().filter((x) => x.id !== e.id);
    keepEarlier(list);
    current.current = { id: e.id, createdAt: e.createdAt, source: e.source, cover: e.cover };
    void kvSet(CURRENT_KEY, current.current);
    setText(e.text);
    void kvSet(TEXT_KEY, e.text);
    setCover(e.cover ?? null);
    setShowEarlier(false);
    window.scrollTo({ top: 0 });
  };

  if (!loaded) return <p className="text-muted">Loading…</p>;

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

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
        <LoginForm
          label="AI reading — much better on designed covers — needs the access code"
          hint="Asked once on this phone. Without it, the phone reads the text itself (less accurate) and it isn't saved for the computer."
          onLoggedIn={() => rememberAi({ configured: true, loggedIn: true })}
        />
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
      <input
        ref={coverRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Front cover photo"
        tabIndex={-1}
        onChange={(e) => void onCover(e.target.files?.[0])}
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
      {has && (
        <button type="button" disabled={reading} onClick={startOver} className={`${button} bg-accent text-accent-contrast`}>
          Start over
        </button>
      )}
      {reading ? (
        <p className="-mt-2 text-center text-xs text-muted">
          {ai.loggedIn ? "The AI is reading it — usually a few seconds." : "This can take a little while on some phones."}{" "}
          {readingSince !== null && (
            <span aria-label="Time so far" className="font-mono tabular-nums">
              {Math.floor(Math.max(0, now - readingSince) / 1000)} s
            </span>
          )}
        </p>
      ) : ai.loggedIn ? (
        <p className="-mt-2 text-center text-xs text-muted">
          Read by AI
          {/* How long the whole wait was, photo to text (V33.1). */}
          {last?.readBy === "ai" && last.reply && (
            <>
              <span aria-label="Model"> ({modelLabel(last.details?.requested ?? last.details?.model)})</span>
              <span aria-label="Time taken"> in {seconds(last.ms)}</span>
            </>
          )}{" "}
          ·{" "}
          <Link href="/extract/saved" className="font-medium text-accent">
            Saved texts
          </Link>{" "}
          ·{" "}
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

      {/* Offered while the AI reads too, so the wait isn't wasted (V30). */}
      {(has || reading) && ai.loggedIn && (
        <section aria-label="Front cover" className="flex flex-col gap-1">
          <button
            type="button"
            disabled={cover === "saving"}
            onClick={() => coverRef.current?.click()}
            className={`${button} gap-2 border border-line bg-surface`}
          >
            <CameraIcon className="size-5" />
            Take a photo of the front cover
          </button>
          {cover && (
            <p role="status" aria-label="Front cover saved" className={`text-center text-sm ${cover === "loggedout" ? "text-danger" : "text-muted"}`}>
              {cover === "saving"
                ? "Saving the front cover…"
                : cover === "held"
                  ? "✓ Front cover taken — it goes to the computer with the text."
                  : cover === "saved"
                  ? "✓ Front cover saved for the computer"
                  : cover === "waiting"
                    ? "No signal — the front cover will be saved by itself when there's signal."
                    : "Not saved: this phone isn't logged in any more. Log in again above."}
            </p>
          )}
        </section>
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
          {ai.loggedIn && save && (
            <p role="status" aria-label="Saved for the computer" className={`-mt-1 text-sm ${save === "loggedout" || save === "editedOnComputer" ? "text-danger" : "text-muted"}`}>
              {save === "saved" ? (
                <>
                  ✓ Saved — it&apos;s on the computer under{" "}
                  <Link href="/extract/saved" className="font-medium text-accent">
                    Saved texts
                  </Link>
                  .
                </>
              ) : save === "saving" ? (
                "Saving…"
              ) : save === "waiting" ? (
                "No signal — it'll be saved for the computer by itself when there's signal."
              ) : save === "editedOnComputer" ? (
                "This text has been corrected on the computer, so changes here aren't saved. Make further changes there, or Start over for a new book."
              ) : (
                "Not saved: this phone isn't logged in any more. Log in again above."
              )}
            </p>
          )}
        </section>
      )}

      {(has || last) && !reading && (
        <section aria-label="Report a problem" className="flex flex-col gap-2">
          {report === "closed" ? (
            <button type="button" onClick={() => setReport("open")} className={`${button} h-14 bg-danger text-lg text-background`}>
              Report a problem
            </button>
          ) : report === "sent" ? (
            <p role="status" className="text-sm text-muted">
              ✓ Reported — the photo and what came back are in the{" "}
              <Link href="/photo-log" className="font-medium text-accent">
                Photo log
              </Link>
              , to find out what went wrong.
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-danger/40 p-3">
              <label htmlFor="report-note" className="text-sm font-medium">
                What went wrong? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="report-note"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                rows={2}
                placeholder="For example: cut off after the second paragraph"
                className="w-full rounded-xl border border-line bg-surface p-3 text-base outline-none focus:border-accent"
              />
              <p className="text-xs text-muted">Sends the last photo and exactly what came back from it, so we can see why.</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={report === "sending"} onClick={() => void sendReport()} className={`${button} bg-danger text-background`}>
                  {report === "sending" ? "Sending…" : "Send report"}
                </button>
                <button type="button" onClick={() => setReport("closed")} className={`${button} border border-line bg-surface`}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Which AI reads (V33.4): to compare them on real covers. Kept on this phone. */}
      {ai.loggedIn && !reading && (
        <label className="flex items-center justify-center gap-2 text-xs text-muted">
          AI model
          <select
            aria-label="AI model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              try {
                if (e.target.value) localStorage.setItem(MODEL_KEY, e.target.value);
                else localStorage.removeItem(MODEL_KEY);
              } catch {
                // private mode: just for now
              }
            }}
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground"
          >
            {AI_MODELS.map((m, i) => (
              <option key={m.id} value={i === 0 ? "" : m.id}>
                {m.label}
                {i === 0 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {earlier.length > 0 && !reading && (
        <section aria-label="Earlier texts on this phone" className="flex flex-col gap-2 border-t border-line pt-3">
          <button type="button" onClick={() => setShowEarlier((v) => !v)} className="self-start text-sm text-muted underline">
            {showEarlier ? "Hide earlier texts" : `Earlier texts on this phone (${earlier.length})`}
          </button>
          {showEarlier && (
            <>
              <p className="text-xs text-muted">Kept on this phone for 7 days. Tap one to open it again.</p>
              <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                {earlier.map((e) => (
                  <li key={e.id} className="border-b border-line last:border-0">
                    <button type="button" onClick={() => openEarlier(e)} className="flex w-full flex-col gap-1 px-4 py-3 text-left active:bg-line/50">
                      <span className="flex justify-between gap-2 text-xs text-muted">
                        <span>{when(e.createdAt)}</span>
                        {e.cover === "saved" && <span>front cover ✓</span>}
                      </span>
                      <span className="line-clamp-2 text-sm">{e.text.replace(/\s+/g, " ").slice(0, 90)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
