"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon } from "@/components/icons";
import { canvasOfFile, frameOf, toJpeg } from "@/lib/client/bookops";

export type Shots = { front: Blob; back: Blob; /** The back as photographed, for reading its barcode. */ backCanvas: HTMLCanvasElement };

type Props = {
  /** Both covers photographed: the book is the screen's from here, and the camera is free for the next. */
  onBook: (shots: Shots) => void;
  /** How the last book went (said under the camera). */
  notice: { kind: "ok" | "warn" | "error"; text: string } | null;
};

type Camera = { deviceId: string; label: string };
const CAMERA_KEY = "bookops:camera";

function stored(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
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
 * BookOps' camera column (docs/spec-corrections.md §27): the computer's
 * camera — a webcam on a stand, or a laptop's own — live, and two pictures
 * per book: the front cover, then the back. Space takes the picture (when
 * nothing is being typed), so both hands can stay on the book.
 *
 * The camera never waits for the book it just photographed: after the back
 * cover it's ready for the next one at once.
 */
export function BookOpsCamera({ onBook, notice }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frontRef = useRef<{ blob: Blob; url: string } | null>(null);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "off">("starting");
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [front, setFront] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (deviceId: string | null) => {
      stop();
      setStatus("starting");
      setError(null);
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
        setCurrent(stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
        setStatus("live");
      } catch (e) {
        setStatus("off");
        setError(navigator.mediaDevices ? why(e) : "This browser can't use a camera here. Use photo files instead.");
      }
    },
    [stop],
  );

  useEffect(() => {
    const first = setTimeout(() => void start(stored()), 0);
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [start, stop]);

  const choose = (deviceId: string) => {
    try {
      localStorage.setItem(CAMERA_KEY, deviceId);
    } catch {
      // Not remembered, that's all.
    }
    void start(deviceId);
  };

  /** One picture: the front cover first, then the back — and the book is done. */
  const shot = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const blob = await toJpeg(canvas);
      const before = frontRef.current;
      if (!before) {
        frontRef.current = { blob, url: URL.createObjectURL(blob) };
        setFront(frontRef.current.url);
        return;
      }
      frontRef.current = null;
      setFront(null);
      URL.revokeObjectURL(before.url);
      onBook({ front: before.blob, back: blob, backCanvas: canvas });
    },
    [onBook],
  );

  const take = useCallback(async () => {
    const video = videoRef.current;
    if (busyRef.current || !video || !streamRef.current) return;
    const canvas = frameOf(video);
    if (!canvas) return;
    busyRef.current = true;
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
      for (const file of [...files].slice(0, 2)) await shot(await canvasOfFile(file));
    } catch {
      setError("Couldn't open that photo file. Try another (JPEG or PNG).");
    } finally {
      busyRef.current = false;
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startOver = () => {
    if (frontRef.current) URL.revokeObjectURL(frontRef.current.url);
    frontRef.current = null;
    setFront(null);
  };

  const live = status === "live";
  const step = "flex min-w-0 items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5";

  return (
    <section aria-label="Camera" className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Camera · next book</h2>

      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline aria-label="Camera picture" className={`size-full object-contain ${live ? "" : "invisible"}`} />
        {live ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-x-[22%] inset-y-[10%] rounded-md border-2 border-dashed border-white/60" />
            <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-red-500" />
              LIVE
            </span>
            <p className="pointer-events-none absolute inset-x-0 bottom-2 px-3 text-center text-sm text-white drop-shadow">
              {front ? "Now the back cover" : "Front cover up, inside the frame"}
            </p>
            {flash && <div aria-hidden className="absolute inset-0 bg-white/70" />}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-white">
            {status === "starting" ? (
              <p>Starting the camera…</p>
            ) : (
              <>
                <p role="alert">{error ?? "The camera is off."}</p>
                <button type="button" onClick={() => void start(current ?? stored())} className="h-10 rounded-lg bg-white px-4 font-medium text-black">
                  Start camera
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ol aria-label="Pictures of this book" className="grid grid-cols-2 gap-2">
        <li className={`${step} ${front ? "border-line" : "border-2 border-accent"}`} aria-current={front ? undefined : "step"}>
          {front && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={front} alt="" className="h-9 w-7 shrink-0 rounded-sm object-cover" />
          )}
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[11px] text-muted">
              Step 1 {front && <CheckIcon className="size-3.5" />}
            </span>
            <span className="block truncate text-sm font-semibold">Front cover</span>
          </span>
        </li>
        <li className={`${step} ${front ? "border-2 border-accent" : "border-line"}`} aria-current={front ? "step" : undefined}>
          <span className="min-w-0">
            <span className="block text-[11px] text-muted">Step 2</span>
            <span className={`block truncate text-sm font-semibold ${front ? "" : "text-muted"}`}>Back cover</span>
          </span>
        </li>
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
        {front && (
          <button type="button" onClick={startOver} className="font-medium text-accent underline-offset-2 hover:underline">
            Retake the front
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
