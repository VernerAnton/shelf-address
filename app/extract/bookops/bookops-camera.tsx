"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, CheckIcon } from "@/components/icons";
import { applyFocus, currentFocus, focusRange, rememberFocus, storedFocus, type FocusRange, type FocusSetting } from "@/lib/client/camera-focus";
import { canvasOfFile, DEFAULT_VIEW, drawView, frameOf, toJpeg, ZOOMS, type CameraView } from "@/lib/client/bookops";

export type Side = "front" | "back";
export type Shots = {
  /** The book the photos are for, or null for a new book. */
  targetId: string | null;
  front?: Blob;
  back?: Blob;
  /** The back as photographed, for reading its barcode. */
  backCanvas?: HTMLCanvasElement;
};
/** The open book, when it still needs photos: the camera's pictures go to it. */
export type CameraTarget = { id: string; title: string; sides: Side[] };

type Props = {
  target: CameraTarget | null;
  /** All the pictures needed are taken: they're the screen's from here, and the camera is free for the next. */
  onShots: (shots: Shots) => void;
  /** How the last book went (said under the camera). */
  notice: { kind: "ok" | "warn" | "error"; text: string } | null;
};

type Camera = { deviceId: string; label: string };
type Taken = { key: string; shots: Partial<Record<Side, { blob: Blob; url: string; canvas: HTMLCanvasElement }>> };
const SIDE_NAME: Record<Side, string> = { front: "Front cover", back: "Back cover" };
const CAMERA_KEY = "bookops:camera";
/** Set while the camera has been stopped by hand: it then stays off when BookOps is opened again, until started. */
const OFF_KEY = "bookops:camera-off";
/** Upright or whole, zoom and turn: set to suit the stand once, remembered on this computer. */
const VIEW_KEY = "bookops:view";

function storedView(): CameraView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<CameraView> | null;
    return {
      shape: v?.shape === "whole" ? "whole" : "upright",
      zoom: ZOOMS.includes(Number(v?.zoom)) ? Number(v?.zoom) : 1,
      turn: ([0, 90, 180, 270] as const).find((t) => t === v?.turn) ?? 0,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}
/** The camera stops by itself after this long without a picture. */
export const IDLE_STOP_MS = 10 * 60 * 1000;

function stored(key = CAMERA_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not remembered, that's all.
  }
}

function why(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked for this page. Allow it (the camera icon in the address bar), then press Start camera.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this computer. Plug one in and press Start camera, or use photo files.";
  if (name === "NotReadableError") return "Another program is using the camera. Close it, then press Start camera.";
  return "The camera couldn't be started. Press Start camera to try again, or use photo files.";
}

/**
 * BookOps' camera column (docs/spec-corrections.md §30): the computer's
 * camera — a webcam on a stand, or a laptop's own — live, and two pictures
 * per book: the back cover (where the barcode is), then the front. Space takes the picture (when
 * nothing is being typed), so both hands can stay on the book.
 *
 * The camera never waits for the book it just photographed: after the back
 * cover it's ready for the next one at once.
 *
 * When the open book still lacks photos (scanned by ISBN, or only its back
 * photographed on a phone), the pictures go to that book, and only the sides
 * it lacks are taken; "New book instead" overrides that. Otherwise two
 * pictures make a new book.
 *
 * The picture is shown book-shaped (upright, 3:4, from the middle of a wide
 * webcam picture), with zoom and turn for the stand, remembered on this
 * computer; what's shown is exactly what's saved (lib/client/bookops.ts).
 *
 * It isn't live all the time: "Stop camera" turns it off (the camera light
 * goes out) and it stays off — also the next time BookOps is opened in this
 * browser — until "Start camera". It also stops by itself after
 * IDLE_STOP_MS without a picture. A front cover already taken is kept.
 */
export function BookOpsCamera({ target, onShots, notice }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const takenRef = useRef<Taken>({ key: "", shots: {} });
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "off">("starting");
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [taken, setTaken] = useState<Taken>({ key: "", shots: {} });
  /** "New book instead" was chosen while this book was open. */
  const [newFor, setNewFor] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  /** Why the camera is off, when it was stopped on purpose (not an error). */
  const [offNote, setOffNote] = useState<string | null>(null);
  const lastUsedRef = useRef(0);
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** The camera's focus range when the browser can set it (null: the camera keeps its own autofocus), and the setting. */
  const [focus, setFocus] = useState<{ range: FocusRange | null; setting: FocusSetting } | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);
  const [view, setViewState] = useState<CameraView>(DEFAULT_VIEW);
  const viewRef = useRef<CameraView>(DEFAULT_VIEW);
  const setView = (next: CameraView) => {
    viewRef.current = next;
    setViewState(next);
    remember(VIEW_KEY, JSON.stringify(next));
  };

  /** Lets go of the camera (its light goes out). */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  /** Turned off on purpose: by the button, or after a while without a picture. */
  const turnOff = useCallback(
    (note: string) => {
      stop();
      setStatus("off");
      setError(null);
      setOffNote(note);
    },
    [stop],
  );

  const start = useCallback(
    async (deviceId: string | null) => {
      stop();
      setStatus("starting");
      setError(null);
      setOffNote(null);
      lastUsedRef.current = Date.now();
      // As large as the camera gives: small print on a back cover needs it.
      const video = (id: string | null): MediaTrackConstraints => ({ ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 3840 }, height: { ideal: 2160 } });
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: video(deviceId), audio: false });
        } catch (e) {
          // The remembered camera may be unplugged: any camera will do.
          if (!deviceId) throw e;
          stream = await navigator.mediaDevices.getUserMedia({ video: video(null), audio: false });
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          await el.play().catch(() => {});
        }
        const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCameras(all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })));
        const track = stream.getVideoTracks()[0];
        const id = track?.getSettings().deviceId ?? deviceId;
        setCurrent(id);
        // Focus: what this camera lets the browser do, and what was chosen for it before.
        const range = focusRange(track);
        // Remembered by the camera's name: its id can change from one visit to the next.
        const name = track?.label || id;
        setCameraName(name);
        const saved = storedFocus(name);
        if (range && track && saved?.mode === "fixed") await applyFocus(track, saved);
        setFocus({ range, setting: range && saved ? saved : { mode: "auto", value: range ? currentFocus(track!, range) : 0 } });
        setStatus("live");
      } catch (e) {
        setStatus("off");
        setError(navigator.mediaDevices ? why(e) : "This browser can't use a camera here. Use photo files instead.");
      }
    },
    [stop],
  );

  useEffect(() => {
    const first = setTimeout(() => {
      viewRef.current = storedView();
      setViewState(viewRef.current);
      if (stored(OFF_KEY)) turnOff("The camera is off.");
      else void start(stored());
    }, 0);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [start, stop, turnOff]);

  // The preview: the view of the camera's picture, drawn as often as the screen refreshes.
  useEffect(() => {
    if (status !== "live") return;
    let frame = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = previewRef.current;
      if (video && canvas && document.visibilityState === "visible") drawView(video, viewRef.current, canvas, 900);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  // Not live all the time: off by itself after a while without a picture.
  useEffect(() => {
    if (status !== "live") return;
    const timer = setInterval(() => {
      if (Date.now() - lastUsedRef.current >= IDLE_STOP_MS) turnOff("The camera stopped by itself after 10 minutes without a picture.");
    }, 15_000);
    return () => clearInterval(timer);
  }, [status, turnOff]);

  const stopByHand = () => {
    remember(OFF_KEY, "1");
    turnOff("The camera is off.");
  };

  const startByHand = () => {
    remember(OFF_KEY, null);
    void start(current ?? stored());
  };

  /** Auto: the camera's own autofocus. Fixed: the focus stays where it is now (where autofocus landed), adjustable. */
  const setFocusMode = async (mode: FocusSetting["mode"]) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !focus?.range) return;
    const setting = { mode, value: mode === "fixed" ? currentFocus(track, focus.range) : focus.setting.value };
    if (!(await applyFocus(track, setting))) return setError("The camera didn't accept that focus setting.");
    setFocus({ ...focus, setting });
    rememberFocus(cameraName, setting);
  };

  const setFocusValue = async (value: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !focus?.range) return;
    const setting: FocusSetting = { mode: "fixed", value };
    setFocus({ ...focus, setting });
    rememberFocus(cameraName, setting);
    await applyFocus(track, setting);
  };

  const choose = (deviceId: string) => {
    remember(CAMERA_KEY, deviceId);
    void start(deviceId);
  };

  /** What the pictures are for: the open book's missing sides, or a new book's two. */
  const forBook = target && newFor !== target.id ? target : null;
  const targetId = forBook?.id ?? null;
  // Back cover first: that is where the barcode is, so it is already facing up after scanning.
  const sidesKey = forBook ? forBook.sides.join(",") : "back,front";
  const plan = useMemo(() => ({ key: `${targetId ?? "new"}:${sidesKey}`, targetId, sides: sidesKey.split(",") as Side[] }), [targetId, sidesKey]);

  const keep = (next: Taken) => {
    takenRef.current = next;
    setTaken(next);
  };

  /** One picture: the next side still needed — and when none is left, the photos go off. */
  const shot = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const blob = await toJpeg(canvas);
      const before = takenRef.current;
      // Pictures half-taken for another book are dropped.
      if (before.key !== plan.key) Object.values(before.shots).forEach((x) => URL.revokeObjectURL(x.url));
      const shots = before.key === plan.key ? before.shots : {};
      const side = plan.sides.find((x) => !shots[x]) ?? plan.sides[0];
      const next = { ...shots, [side]: { blob, url: URL.createObjectURL(blob), canvas } };
      if (plan.sides.every((x) => next[x])) {
        Object.values(next).forEach((x) => URL.revokeObjectURL(x.url));
        keep({ key: plan.key, shots: {} });
        onShots({ targetId: plan.targetId, front: next.front?.blob, back: next.back?.blob, backCanvas: next.back?.canvas });
        return;
      }
      keep({ key: plan.key, shots: next });
    },
    [plan, onShots],
  );

  const take = useCallback(async () => {
    const video = videoRef.current;
    if (busyRef.current || !video || !streamRef.current) return;
    const canvas = frameOf(video, viewRef.current);
    if (!canvas) return;
    busyRef.current = true;
    lastUsedRef.current = Date.now();
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    try {
      await shot(canvas);
    } catch {
      setError("Couldn't take that picture. Try again.");
    } finally {
      busyRef.current = false;
    }
  }, [shot]);

  // Space takes the picture — unless something is being typed, or a button or link has the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, a, [contenteditable=true]")) return;
      e.preventDefault();
      void take();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [take]);

  /** Photo files instead of the camera: one is the next picture; two are the front and the back. */
  const onFiles = async (files: FileList | null) => {
    if (!files?.length || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      for (const file of [...files].slice(0, plan.sides.length)) await shot(await canvasOfFile(file));
    } catch {
      setError("Couldn't open that photo file. Try another (JPEG or PNG).");
    } finally {
      busyRef.current = false;
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startOver = () => {
    Object.values(takenRef.current.shots).forEach((x) => URL.revokeObjectURL(x.url));
    keep({ key: plan.key, shots: {} });
  };

  const shots = taken.key === plan.key ? taken.shots : {};
  const nextSide = plan.sides.find((x) => !shots[x]) ?? plan.sides[0];
  const started = Object.keys(shots).length > 0;
  const live = status === "live";
  const step = "flex min-w-0 items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5";

  return (
    <section aria-label="Camera" className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-xs font-semibold tracking-wider text-muted uppercase">
          {forBook ? (
            <>
              Photos for: <span className="text-foreground normal-case tracking-normal">{forBook.title}</span>
            </>
          ) : (
            "Camera · new book"
          )}
        </h2>
        {status !== "off" && (
          <button type="button" onClick={stopByHand} className="h-8 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:border-accent">
            Stop camera
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl bg-black" style={live ? undefined : { aspectRatio: view.shape === "upright" ? "3 / 4" : "4 / 3" }}>
        {/* The camera itself, out of sight: the canvas shows the view of it. */}
        <video ref={videoRef} muted playsInline aria-label="Camera picture" className="pointer-events-none absolute top-0 left-0 size-px opacity-0" />
        <canvas ref={previewRef} aria-label="Camera view" className={`block h-auto max-h-[70vh] w-full object-contain ${live ? "" : "hidden"}`} />
        {live ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-[4%] rounded-md border-2 border-dashed border-white/50" />
            <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE
            </span>
            <p className="pointer-events-none absolute inset-x-0 bottom-2 px-3 text-center text-sm text-white drop-shadow">
              {nextSide === "front" ? (started ? "Now the front cover" : "Front cover up, inside the frame") : "Back cover up, inside the frame"}
            </p>
            {flash && <div aria-hidden className="absolute inset-0 bg-white/70" />}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white">
            {status === "starting" ? (
              <p>Starting the camera…</p>
            ) : (
              <>
                {error ? <p role="alert">{error}</p> : <p role="status" aria-label="Camera off">{offNote ?? "The camera is off."}</p>}
                <button type="button" onClick={startByHand} className="h-10 rounded-lg bg-white px-4 font-medium text-black">
                  Start camera
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ol aria-label="Pictures of this book" className={`grid gap-2 ${plan.sides.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {plan.sides.map((side, i) => {
          const done = shots[side];
          const now = side === nextSide;
          return (
            <li key={side} className={`${step} ${now ? "border-2 border-accent" : "border-line"}`} aria-current={now ? "step" : undefined}>
              {done && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={done.url} alt="" className="h-9 w-7 shrink-0 rounded-sm object-cover" />
              )}
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  {plan.sides.length > 1 ? `Step ${i + 1}` : "Still needed"} {done && <CheckIcon className="size-3.5" />}
                </span>
                <span className={`block truncate text-sm font-semibold ${now || done ? "" : "text-muted"}`}>{SIDE_NAME[side]}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        disabled={!live}
        onClick={() => void take()}
        className="flex h-13 items-center justify-center gap-2 rounded-xl bg-accent text-base font-semibold text-accent-contrast disabled:opacity-40"
      >
        <CameraIcon className="size-5" />
        Take picture
        <kbd className="rounded bg-white/20 px-2 py-0.5 font-sans text-xs font-medium">Space</kbd>
      </button>

      {live && (
        <div role="group" aria-label="Camera view settings" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center overflow-hidden rounded-lg border border-line bg-surface">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={view.zoom === ZOOMS[0]}
              onClick={() => setView({ ...view, zoom: ZOOMS[Math.max(0, ZOOMS.indexOf(view.zoom) - 1)] })}
              className="h-9 w-9 font-semibold disabled:opacity-30"
            >
              −
            </button>
            <span aria-label="Zoom" className="min-w-12 text-center tabular-nums">
              {String(view.zoom).replace(".", ",")}×
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={view.zoom === ZOOMS.at(-1)}
              onClick={() => setView({ ...view, zoom: ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(view.zoom) + 1)] })}
              className="h-9 w-9 font-semibold disabled:opacity-30"
            >
              +
            </button>
          </span>
          <button
            type="button"
            onClick={() => setView({ ...view, turn: (((view.turn + 90) % 360) as CameraView["turn"]) })}
            className="h-9 rounded-lg border border-line bg-surface px-3"
            title="For a webcam mounted on its side"
          >
            Turn ↻{view.turn ? ` ${view.turn}°` : ""}
          </button>
          <button
            type="button"
            aria-pressed={view.shape === "whole"}
            onClick={() => setView({ ...view, shape: view.shape === "upright" ? "whole" : "upright" })}
            className="h-9 rounded-lg border border-line bg-surface px-3"
          >
            {view.shape === "upright" ? "Whole picture" : "Book-shaped"}
          </button>
        </div>
      )}

      {live && focus && (
        <div role="group" aria-label="Focus" className="flex flex-col gap-2 text-sm">
          {focus.range ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Focus</span>
                <span className="flex overflow-hidden rounded-lg border border-line bg-surface">
                  {(["auto", "fixed"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={focus.setting.mode === mode}
                      onClick={() => void setFocusMode(mode)}
                      className={`h-9 px-3 ${focus.setting.mode === mode ? "bg-accent text-accent-contrast" : ""}`}
                    >
                      {mode === "auto" ? "Auto" : "Fixed"}
                    </button>
                  ))}
                </span>
              </div>
              {focus.setting.mode === "fixed" ? (
                <label className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted">Near</span>
                  <input
                    type="range"
                    aria-label="Focus distance"
                    min={focus.range.min}
                    max={focus.range.max}
                    step={focus.range.step}
                    value={focus.setting.value}
                    onChange={(e) => void setFocusValue(Number(e.target.value))}
                    className="min-w-0 flex-1 accent-[var(--accent)]"
                  />
                  <span className="shrink-0 text-xs text-muted">Far</span>
                </label>
              ) : (
                <p className="text-xs text-muted">
                  Tip: hold a book where it will lie, let the camera focus, then press Fixed — the focus stays there, no waiting.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">
              This camera doesn&apos;t let the browser set its focus, so it uses its own autofocus. Its own settings app (from the
              camera&apos;s maker, or the computer&apos;s camera settings) can often turn autofocus off and fix the focus.
            </p>
          )}
        </div>
      )}

      {live && error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {cameras.length > 1 && (
          <label className="flex min-w-0 items-center gap-2">
            <span className="text-muted">Camera</span>
            <select
              value={current ?? ""}
              onChange={(e) => choose(e.target.value)}
              className="h-9 max-w-44 min-w-0 rounded-lg border border-line bg-surface px-2 text-sm"
            >
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Photo files"
          tabIndex={-1}
          onChange={(e) => void onFiles(e.target.files)}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="font-medium text-accent underline-offset-2 hover:underline">
          Use photo files
        </button>
        {started && (
          <button type="button" onClick={startOver} className="font-medium text-accent underline-offset-2 hover:underline">
            Retake
          </button>
        )}
        {target && (
          <button
            type="button"
            onClick={() => {
              startOver();
              setNewFor(forBook ? target.id : null);
            }}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            {forBook ? "New book instead" : `Photos for: ${target.title}`}
          </button>
        )}
      </div>

      {notice && (
        <p
          role="status"
          aria-label="Last book"
          className={`rounded-lg border p-2.5 text-sm ${
            notice.kind === "error"
              ? "border-danger/40 text-danger"
              : notice.kind === "warn"
                ? "border-warn-line bg-warn-bg text-warn-text"
                : "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          }`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
