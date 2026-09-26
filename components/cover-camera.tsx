"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { claimCamera } from "@/lib/client/camera";
import { detectBook, flattenCover, startVision, type Corners, type Pixels } from "@/lib/client/cover-vision";

type Props = {
  /** The book's title (or ISBN), for the heading. */
  title: string;
  /** Stores the finished cover. Throw an Error to show its message and stay open. */
  onSave: (cover: Blob) => Promise<void>;
  onClose: () => void;
};

type Stage =
  | { kind: "live" }
  | { kind: "adjust"; photo: Pixels; url: string; corners: Corners; found: boolean }
  | { kind: "saving"; photo: Pixels; url: string; corners: Corners; found: boolean };

/** Where the corners start when no book was found: a book-shaped guide frame. */
const GUIDE: Corners = [
  [0.2, 0.1],
  [0.8, 0.1],
  [0.8, 0.9],
  [0.2, 0.9],
];
const LIVE_SIDE = 400;
const STILL_SIDE = 480;
const PICKED_MAX = 2400;
const LIVE_EVERY_MS = 250;

function pixelsOf(source: CanvasImageSource, width: number, height: number, maxSide: number): Pixels {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

function toCanvas(pixels: Pixels): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), type, quality),
  );
}

/** Eases the live outline towards each new detection so it doesn't jitter. */
function smooth(previous: Corners | null, next: Corners): Corners {
  if (!previous) return next;
  return next.map((p, i) => [previous[i][0] * 0.4 + p[0] * 0.6, previous[i][1] * 0.4 + p[1] * 0.6]) as Corners;
}

/**
 * A box of exactly `aspect`, as large as fits in the space available, so
 * overlays drawn in fractions of it line up with the picture inside.
 */
function FitBox({ aspect, className = "", children }: { aspect: number; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = outer.current!;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.min(width, height * aspect);
      setSize({ width: w, height: w / aspect });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);
  return (
    <div ref={outer} className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
      <div className={`relative ${className}`} style={size ?? { width: 0, height: 0 }}>
        {children}
      </div>
    </div>
  );
}

function Outline({ corners, found }: { corners: Corners; found: boolean }) {
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
      <polygon
        points={corners.map((c) => c.join(",")).join(" ")}
        fill={found ? "rgb(16 185 129 / 0.15)" : "none"}
        stroke={found ? "rgb(16 185 129)" : "white"}
        strokeWidth={found ? 3 : 2}
        strokeDasharray={found ? undefined : "8 6"}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Photographing a cover (docs/spec-corrections.md §15), the way document
 * scanners do it: the camera outlines the book as it finds it; after the shot,
 * four corner handles start on the book's corners (drag to correct, with a
 * magnifier under the finger); saving straightens and crops it.
 */
export function CoverCamera({ title, onSave, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveCornersRef = useRef<Corners | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "live" });
  const [live, setLive] = useState<{ corners: Corners | null; aspect: number | null }>({ corners: null, aspect: null });
  const [vision, setVision] = useState<"loading" | "ready" | "unavailable">("loading");
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void startVision().then((ok) => alive && setVision(ok ? "ready" : "unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  // The barcode scanner hands over the camera while this is open.
  useEffect(() => claimCamera(), []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Camera on while live, off otherwise.
  useEffect(() => {
    if (stage.kind !== "live") return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: "NotSupportedError" });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setCameraError(null);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setCameraError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera access was refused. You can choose a photo instead."
            : "The camera couldn't start. You can choose a photo instead.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stage.kind, stopStream]);

  // Live outline: look for the book a few times a second.
  useEffect(() => {
    if (stage.kind !== "live" || vision !== "ready") return;
    let busy = false;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      if (busy || !video || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      try {
        const frame = pixelsOf(video, video.videoWidth, video.videoHeight, LIVE_SIDE);
        const corners = await detectBook(frame);
        liveCornersRef.current = corners ? smooth(liveCornersRef.current, corners) : null;
        setLive((l) => ({ ...l, corners: liveCornersRef.current }));
      } finally {
        busy = false;
      }
    }, LIVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [stage.kind, vision]);

  // The still's preview URL: freed when replaced, and on close.
  const urlRef = useRef<string | null>(null);
  const keepUrl = (url: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
  };
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  /** A still (from the camera or a chosen file): find the book, then adjust. */
  const toAdjust = useCallback(async (photo: Pixels, fallback: Corners | null) => {
    const small = pixelsOf(toCanvas(photo), photo.width, photo.height, STILL_SIDE);
    const detected = await detectBook(small);
    const corners = detected ?? fallback ?? GUIDE;
    const url = URL.createObjectURL(await toBlob(toCanvas(photo), "image/jpeg", 0.9));
    keepUrl(url);
    setError(null);
    setStage({ kind: "adjust", photo, url, corners, found: Boolean(detected ?? fallback) });
  }, []);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const photo = pixelsOf(video, video.videoWidth, video.videoHeight, Infinity);
    stopStream();
    await toAdjust(photo, liveCornersRef.current);
  }, [stopStream, toAdjust]);

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const bitmap = await createImageBitmap(file);
        const photo = pixelsOf(bitmap, bitmap.width, bitmap.height, PICKED_MAX);
        stopStream();
        await toAdjust(photo, null);
      } catch {
        setError("Couldn't read that photo. Try a JPEG or PNG.");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [stopStream, toAdjust],
  );

  const save = useCallback(async () => {
    if (stage.kind !== "adjust") return;
    setStage({ ...stage, kind: "saving" });
    try {
      const cover = await flattenCover(stage.photo, stage.corners);
      await onSave(await toBlob(toCanvas(cover), "image/jpeg", 0.85));
      onClose();
    } catch (e) {
      setError((e as Error)?.message || "Couldn't save the photo. Try again.");
      setStage({ ...stage, kind: "adjust" });
    }
  }, [stage, onSave, onClose]);

  const status =
    vision === "loading"
      ? "Getting edge detection ready…"
      : vision === "unavailable"
        ? "Fill the frame with the cover — you can set the corners after."
        : live.corners
          ? "Book found. Hold still and take the photo."
          : "Point at the cover, on a plain surface if you can.";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Photograph the cover of ${title}`} className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <div className="flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <p className="min-w-0 flex-1 truncate font-medium">Cover of {title}</p>
        <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-full bg-white/15 px-4 text-sm">
          Close
        </button>
      </div>

      {stage.kind === "live" ? (
        <>
          {cameraError ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <p role="alert" className="max-w-xs p-6 text-center">{cameraError}</p>
            </div>
          ) : (
            <FitBox aspect={live.aspect ?? 3 / 4}>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  aria-label="Camera view"
                  onLoadedMetadata={(e) =>
                    setLive((l) => ({ ...l, aspect: e.currentTarget.videoWidth / e.currentTarget.videoHeight }))
                  }
                  className="size-full object-fill"
                />
                <Outline corners={live.corners ?? GUIDE} found={Boolean(live.corners)} />
            </FitBox>
          )}
          <p role="status" aria-live="polite" className="px-4 pt-3 text-center text-sm text-white/80">
            {status}
          </p>
          <div className="flex items-center justify-between px-6 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => fileRef.current?.click()} className="h-11 w-24 text-left text-sm underline">
              Choose a photo
            </button>
            <button
              type="button"
              onClick={() => void shoot()}
              disabled={Boolean(cameraError)}
              aria-label="Take photo"
              className="size-18 rounded-full border-4 border-white bg-white/25 disabled:opacity-30"
            />
            <span className="w-24" />
          </div>
        </>
      ) : (
        <Adjust
          stage={stage}
          onCorners={(corners) => stage.kind === "adjust" && setStage({ ...stage, corners })}
          onRetake={() => {
            setError(null);
            liveCornersRef.current = null;
            setLive((l) => ({ ...l, corners: null }));
            setStage({ kind: "live" });
          }}
          onSave={() => void save()}
          error={error}
        />
      )}
      {error && stage.kind === "live" && (
        <p role="alert" className="px-4 pb-4 text-center text-sm text-red-300">{error}</p>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Cover photo file" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

const LOUPE = 110;
const ZOOM = 2.5;

function Adjust({
  stage,
  onCorners,
  onRetake,
  onSave,
  error,
}: {
  stage: Extract<Stage, { kind: "adjust" | "saving" }>;
  onCorners: (corners: Corners) => void;
  onRetake: () => void;
  onSave: () => void;
  error: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [boxSize, setBoxSize] = useState<{ width: number; height: number } | null>(null);
  const saving = stage.kind === "saving";
  const { corners, photo, url } = stage;

  const move = (index: number, event: ReactPointerEvent) => {
    const box = boxRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    onCorners(corners.map((c, i) => (i === index ? [x, y] : c)) as Corners);
  };
  const nudge = (index: number, dx: number, dy: number) =>
    onCorners(
      corners.map((c, i) =>
        i === index ? [Math.min(1, Math.max(0, c[0] + dx)), Math.min(1, Math.max(0, c[1] + dy))] : c,
      ) as Corners,
    );

  const names = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];
  const box = boxSize;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <FitBox aspect={photo.width / photo.height} className="touch-none select-none">
          <div ref={boxRef} className="absolute inset-0" />
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, not a page asset */}
          <img src={url} alt="The photo taken" className="size-full" draggable={false} />
          <Outline corners={corners} found />
          {corners.map(([x, y], i) => (
            <button
              key={i}
              type="button"
              aria-label={`${names[i]} corner`}
              disabled={saving}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = boxRef.current!.getBoundingClientRect();
                setBoxSize({ width: rect.width, height: rect.height });
                setDragging(i);
              }}
              onPointerMove={(e) => dragging === i && move(i, e)}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(e) => {
                const step = 0.01;
                const keys: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                if (keys[e.key]) {
                  e.preventDefault();
                  nudge(i, ...keys[e.key]);
                }
              }}
              className="absolute size-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-emerald-500/40 shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          ))}
          {dragging !== null && box && (
            // Magnifier above the finger, so the corner under it can be seen.
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-white shadow-lg"
              style={{
                width: LOUPE,
                height: LOUPE,
                left: `calc(${corners[dragging][0] * 100}% - ${LOUPE / 2}px)`,
                top: `calc(${corners[dragging][1] * 100}% - ${LOUPE + 40}px)`,
                backgroundImage: `url(${url})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${box.width * ZOOM}px ${box.height * ZOOM}px`,
                backgroundPosition: `${LOUPE / 2 - corners[dragging][0] * box.width * ZOOM}px ${LOUPE / 2 - corners[dragging][1] * box.height * ZOOM}px`,
              }}
            >
              <span className="absolute top-1/2 left-1/2 size-2 -translate-1/2 rounded-full bg-emerald-400" />
            </div>
          )}
        </FitBox>
      </div>
      <p role="status" className="px-4 text-center text-sm text-white/80">
        {stage.found
          ? "Check the corners sit on the book's corners — drag any that don't."
          : "Couldn't find the book's edges. Drag the corners onto the book's corners."}
      </p>
      {error && (
        <p role="alert" className="px-4 pt-2 text-center text-sm text-red-300">{error}</p>
      )}
      <div className="flex gap-3 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <button type="button" onClick={onRetake} disabled={saving} className="h-12 flex-1 rounded-xl bg-white/15 font-medium">
          Retake
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="h-12 flex-1 rounded-xl bg-emerald-500 font-medium text-black disabled:opacity-60">
          {saving ? "Saving…" : "Save cover"}
        </button>
      </div>
    </>
  );
}
