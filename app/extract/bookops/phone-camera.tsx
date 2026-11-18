"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon } from "@/components/icons";
import { claimCamera } from "@/lib/client/camera";
import { canvasOfFile, toJpeg } from "@/lib/client/bookops";

export type Side = "front" | "back";
export type Shot = { blob: Blob; url: string; canvas: HTMLCanvasElement };

const STEP: Record<Side, { name: string; hint: string; next: string }> = {
  back: { name: "Back cover", hint: "The side with the barcode", next: "Back cover" },
  front: { name: "Front cover", hint: "This is the listing's picture", next: "Turn the book over: front cover" },
};

type Props = {
  /** What the photos are for, e.g. "Photos for: Sinuhe egyptiläinen". */
  title: string;
  /** The sides to take, in order (back cover first). */
  sides: Side[];
  /** All the sides are taken: the photos are the caller's from here (the camera has closed). */
  onDone: (shots: Partial<Record<Side, Shot>>) => void;
  onCancel: () => void;
};

/** A still photo from the camera at its full size where the browser can (ImageCapture), else the live picture. */
async function still(track: MediaStreamTrack, video: HTMLVideoElement): Promise<Blob> {
  const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
  if (Capture) {
    try {
      return await new Capture(track).takePhoto();
    } catch {
      // Not on this phone: the live picture instead.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("No picture");
  return blob;
}

/**
 * BookOps' camera on a phone (docs/spec-corrections.md §27): full screen,
 * inside the app, with the step written over the picture — "1 of 2 · Back
 * cover", then by itself "2 of 2 · Front cover" — and one big shutter. When
 * the last side is taken it closes and hands the photos over. The scanner
 * lets go of the camera while it's open.
 *
 * The phone's own camera app is one tap away ("Use the camera app"), for a
 * phone whose browser camera struggles; its photo counts as the same step.
 */
export function PhoneCamera({ title, sides, onDone, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [shots, setShots] = useState<Partial<Record<Side, Shot>>>({});
  /** "app": the phone's camera app is open instead (this page let go of the camera for it). */
  const [status, setStatus] = useState<"starting" | "live" | "failed" | "app">("starting");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });

  const stoppedRef = useRef(false);

  /** The live camera (the back one, as large as it gives). */
  const start = useCallback(async () => {
    setStatus("starting");
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (stoppedRef.current) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        // Continuous autofocus, where the camera offers it.
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
        if (caps.focusMode?.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
        setTorch({ available: Boolean(caps.torch), on: false });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setStatus("live");
    } catch {
      if (!stoppedRef.current) setStatus("failed");
    }
  }, []);

  // The camera: the scanner hands it over while this is open, and gets it back after.
  useEffect(() => {
    const release = claimCamera();
    stoppedRef.current = false;
    const timer = setTimeout(() => void start(), 0);
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      release();
    };
  }, [start]);

  const next = sides.find((s) => !shots[s]) ?? null;
  const index = next ? sides.indexOf(next) : sides.length - 1;

  /** A picture for the current step; after the last one, the photos go to the caller. */
  const keep = useCallback(
    async (blob: Blob) => {
      if (!next) return;
      const canvas = await canvasOfFile(blob);
      const jpeg = await toJpeg(canvas);
      const all = { ...shots, [next]: { blob: jpeg, url: URL.createObjectURL(jpeg), canvas } };
      if (sides.every((s) => all[s])) onDone(all);
      else setShots(all);
    },
    [next, shots, sides, onDone],
  );

  const take = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    if (busyRef.current || !track || !video || !next) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    try {
      await keep(await still(track, video));
    } catch {
      setError("Couldn't take that picture. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** The phone's own camera app instead, for this step; then the live camera again for the next. */
  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (file) {
      setBusy(true);
      try {
        await keep(file);
      } catch {
        setError("Couldn't open that photo. Try again.");
      } finally {
        setBusy(false);
      }
    }
    if (!stoppedRef.current) void start();
  };

  /** Back one step: the last picture taken is thrown away, to take it again. */
  const retake = () => {
    const last = [...sides].reverse().find((s) => shots[s]);
    if (!last) return;
    URL.revokeObjectURL(shots[last]!.url);
    const rest = { ...shots };
    delete rest[last];
    setShots(rest);
  };

  const cancel = () => {
    Object.values(shots).forEach((s) => URL.revokeObjectURL(s.url));
    onCancel();
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {});
    setTorch({ available: true, on });
  };

  const step = next ? STEP[next] : null;
  const started = Object.keys(shots).length > 0;

  return (
    <section
      aria-label="Taking photos"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm text-white/80">{title}</p>
        <button type="button" onClick={cancel} className="h-10 shrink-0 rounded-lg bg-white/15 px-3 text-sm font-medium">
          Cancel
        </button>
      </div>

      {step && (
        <div aria-label="Step" role="status" className="px-4 pb-3">
          <p className="text-xs font-semibold tracking-wider text-white/70 uppercase">
            {sides.length > 1 ? `${index + 1} of ${sides.length}` : "Photo"}
          </p>
          <p className="text-2xl font-semibold">{started && next === "front" ? STEP.front.next : step.name}</p>
          <p className="text-sm text-white/80">{step.hint}</p>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline aria-label="Camera picture" className="size-full object-cover" />
        {status === "live" && <div aria-hidden className="pointer-events-none absolute inset-x-[12%] inset-y-[8%] rounded-lg border-2 border-dashed border-white/60" />}
        {flash && <div aria-hidden className="absolute inset-0 bg-white/80" />}
        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {status === "starting" ? (
              <p>Starting the camera…</p>
            ) : status === "app" ? (
              <p>Using the phone&apos;s camera app…</p>
            ) : (
              <p role="alert">The camera couldn&apos;t be started here. Use the phone&apos;s camera app below.</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="px-4 pt-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          {sides.map((s) =>
            shots[s] ? (
              <span key={s} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shots[s]!.url} alt={`${STEP[s].name} taken`} className="h-14 w-10 rounded object-cover" />
                <CheckIcon className="absolute -right-1 -bottom-1 size-4 rounded-full bg-emerald-500 p-0.5 text-white" />
              </span>
            ) : null,
          )}
          {started && (
            <button type="button" onClick={retake} disabled={busy} className="h-10 rounded-lg bg-white/15 px-3 text-sm font-medium">
              Retake
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Take picture"
          disabled={status !== "live" || busy || !next}
          onClick={() => void take()}
          className="size-20 rounded-full border-4 border-white bg-white/90 shadow-lg active:scale-95 disabled:opacity-40"
        />
        <div className="flex justify-end">
          {torch.available && (
            <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} className="h-10 rounded-lg bg-white/15 px-3 text-sm font-medium">
              {torch.on ? "Light off" : "Light"}
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Photo from the camera app"
        tabIndex={-1}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy || !next}
        onClick={() => {
          // The camera app can't open while this page holds the camera.
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setStatus("app");
          fileRef.current?.click();
        }}
        className="flex items-center justify-center gap-2 pb-4 text-sm text-white/80 underline"
      >
        <CameraIcon className="size-4" />
        Use the phone&apos;s camera app instead
      </button>
    </section>
  );
}
