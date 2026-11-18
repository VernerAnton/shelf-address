"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon, FlashlightIcon } from "@/components/icons";
import { backCameras, pickMainCamera, zoomSteps, type CameraDevice } from "@/lib/camera-choice";
import { claimCamera } from "@/lib/client/camera";
import { canvasOfFile, cropCanvas, frameInPhoto, toJpeg } from "@/lib/client/bookops";

export type Side = "front" | "back";
export type Shot = { blob: Blob; url: string; canvas: HTMLCanvasElement };

const STEP: Record<Side, { name: string; hint: string; next: string }> = {
  back: { name: "Back cover", hint: "The side with the barcode", next: "Back cover" },
  front: { name: "Front cover", hint: "This is the listing's picture", next: "Turn the book over: front cover" },
};

/** Remembered on this phone, as the scanner remembers its own (BookOps' photos can want another lens). */
const LENS_KEY = "bookops:photo-lens";
const ZOOM_KEY = "bookops:photo-zoom";
const LIGHT_KEY = "bookops:photo-light";
/** The scanner's lens: the starting point before a lens has been chosen here. */
const SCANNER_LENS_KEY = "scanner:camera";

type Caps = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number }; focusMode?: string[] };

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not remembered, that's all.
  }
}

async function videoInputs(): Promise<CameraDevice[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

type Props = {
  /** What the photos are for, e.g. "Photos for: Sinuhe egyptiläinen". */
  title: string;
  /** The sides to take, in order (back cover first). */
  sides: Side[];
  /** All the sides are taken: the photos are the caller's from here (the camera has closed). */
  onDone: (shots: Partial<Record<Side, Shot>>) => void;
  onCancel: () => void;
};

/** A still photo at the camera's full size where the browser can (ImageCapture), else the live picture. */
async function still(track: MediaStreamTrack, video: HTMLVideoElement): Promise<{ blob: Blob; live: boolean }> {
  const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
  if (Capture) {
    try {
      return { blob: await new Capture(track).takePhoto(), live: false };
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
  return { blob, live: true };
}

/**
 * BookOps' camera on a phone (docs/spec-corrections.md §27): full screen,
 * inside the app, with the step written over the picture — "1 of 2 · Back
 * cover", then by itself "2 of 2 · Front cover" — and one big shutter. When
 * the last side is taken it closes and hands the photos over. The scanner
 * lets go of the camera while it's open.
 *
 * **What's inside the dotted frame is what's saved**: the photo is cut to it
 * (`frameInPhoto`). The same lens, zoom and light buttons as the scanner,
 * remembered on this phone.
 *
 * The phone's own camera app is one tap away ("Use the camera app"), for a
 * phone whose browser camera struggles; its photo counts as the same step
 * (not cut: the frame isn't there).
 */
export function PhoneCamera({ title, sides, onDone, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const stoppedRef = useRef(false);
  const [shots, setShots] = useState<Partial<Record<Side, Shot>>>({});
  /** "app": the phone's camera app is open instead (this page let go of the camera for it). */
  const [status, setStatus] = useState<"starting" | "live" | "failed" | "app">("starting");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [zoom, setZoom] = useState<{ steps: number[]; value: number }>({ steps: [], value: 1 });
  const [lenses, setLenses] = useState<{ list: CameraDevice[]; current: string | null }>({ list: [], current: null });

  const track = () => streamRef.current?.getVideoTracks()[0];

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  /** Opens a lens (by id, or "the back one"), as large as it gives. */
  const open = async (deviceId: string | null) => {
    stopStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    if (stoppedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
  };

  /** Autofocus, and the zoom and light as they were last left here; what the buttons can offer. */
  const tune = async () => {
    const t = track();
    const caps = t?.getCapabilities?.() as Caps | undefined;
    if (t && caps?.focusMode?.includes("continuous")) {
      await t.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
    }
    let lit = false;
    if (t && caps?.torch && stored(LIGHT_KEY) === "on") {
      lit = await t.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).then(() => true, () => false);
    }
    setTorch({ available: Boolean(caps?.torch), on: lit });
    const steps = zoomSteps(caps?.zoom ?? null);
    const settings = t?.getSettings() as (MediaTrackSettings & { zoom?: number }) | undefined;
    let value = settings?.zoom ?? 1;
    const wanted = Number(stored(ZOOM_KEY));
    if (t && steps.includes(wanted) && wanted !== value) {
      value = await t.applyConstraints({ advanced: [{ zoom: wanted } as MediaTrackConstraintSet] }).then(() => wanted, () => value);
    }
    setZoom({ steps, value });
    setLenses({ list: backCameras(await videoInputs()), current: settings?.deviceId ?? null });
  };

  /** The live camera: the lens asked for, else the one used here last, else the scanner's, else the main back lens. */
  const start = useCallback(async (lens?: string) => {
    setStatus("starting");
    try {
      const devices = await videoInputs();
      const known = (id: string | null) => (id && devices.some((d) => d.deviceId === id) ? id : null);
      const wanted = known(lens ?? null) ?? known(stored(LENS_KEY)) ?? known(stored(SCANNER_LENS_KEY)) ?? pickMainCamera(devices);
      try {
        await open(wanted);
      } catch (e) {
        if (!wanted) throw e;
        store(LENS_KEY, null);
        await open(null);
      }
      if (stoppedRef.current) return;
      if (!wanted) {
        // First time: now the labels are known, the main lens if this isn't it.
        const main = pickMainCamera(await videoInputs());
        if (main && main !== track()?.getSettings().deviceId) await open(main).catch(() => open(null));
      }
      await tune();
      setStatus("live");
    } catch {
      if (!stoppedRef.current) setStatus("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open and tune only use refs and setters
  }, []);

  // The camera: the scanner hands it over while this is open, and gets it back after.
  useEffect(() => {
    const release = claimCamera();
    stoppedRef.current = false;
    const timer = setTimeout(() => void start(), 0);
    return () => {
      stoppedRef.current = true;
      clearTimeout(timer);
      stopStream();
      release();
    };
  }, [start]);

  const toggleTorch = async () => {
    const t = track();
    if (!t) return;
    const on = !torch.on;
    try {
      await t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ available: true, on });
      store(LIGHT_KEY, on ? "on" : null);
    } catch {
      setTorch({ available: false, on: false });
    }
  };

  const nextZoom = async () => {
    const t = track();
    if (!t || zoom.steps.length === 0) return;
    const value = zoom.steps[(zoom.steps.indexOf(zoom.value) + 1) % zoom.steps.length];
    try {
      await t.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoom((z) => ({ ...z, value }));
      store(ZOOM_KEY, value === 1 ? null : String(value));
    } catch {
      setZoom({ steps: [], value: 1 });
    }
  };

  /** The next back lens, remembered on this phone. */
  const nextLens = async () => {
    const { list, current } = lenses;
    if (list.length < 2) return;
    const next = list[(list.findIndex((d) => d.deviceId === current) + 1) % list.length].deviceId;
    store(LENS_KEY, next);
    await start(next);
  };

  const next = sides.find((s) => !shots[s]) ?? null;
  const index = next ? sides.indexOf(next) : sides.length - 1;

  /** A picture for the current step; after the last one, the photos go to the caller. */
  const keep = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!next) return;
      const jpeg = await toJpeg(canvas);
      const all = { ...shots, [next]: { blob: jpeg, url: URL.createObjectURL(jpeg), canvas } };
      if (sides.every((s) => all[s])) onDone(all);
      else setShots(all);
    },
    [next, shots, sides, onDone],
  );

  /** The photo cut to the dotted frame (the whole photo if it can't be matched to the screen). */
  const toFrame = (photo: HTMLCanvasElement, video: HTMLVideoElement): HTMLCanvasElement => {
    const box = boxRef.current?.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    if (!box || !frame || !video.videoWidth) return photo;
    const rect = frameInPhoto(
      { width: box.width, height: box.height },
      { x: frame.left - box.left, y: frame.top - box.top, width: frame.width, height: frame.height },
      { width: video.videoWidth, height: video.videoHeight },
      { width: photo.width, height: photo.height },
    );
    return rect && rect.width > 10 && rect.height > 10 ? cropCanvas(photo, rect) : photo;
  };

  const take = async () => {
    const t = track();
    const video = videoRef.current;
    if (busyRef.current || !t || !video || !next) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    try {
      const { blob } = await still(t, video);
      await keep(toFrame(await canvasOfFile(blob), video));
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
        await keep(await canvasOfFile(file));
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

  const step = next ? STEP[next] : null;
  const started = Object.keys(shots).length > 0;
  const lensIndex = lenses.list.findIndex((d) => d.deviceId === lenses.current);
  const pill = "flex h-10 items-center gap-1.5 rounded-full bg-white/15 px-3 text-sm font-medium";

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
          <p className="text-xs font-semibold tracking-wider text-white/70 uppercase">{sides.length > 1 ? `${index + 1} of ${sides.length}` : "Photo"}</p>
          <p className="text-2xl font-semibold">{started && next === "front" ? STEP.front.next : step.name}</p>
          <p className="text-sm text-white/80">{step.hint} · fill the frame with the book</p>
        </div>
      )}

      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline aria-label="Camera picture" className="size-full object-cover" />
        {status === "live" && (
          <div ref={frameRef} aria-hidden className="pointer-events-none absolute inset-x-[8%] inset-y-[5%] rounded-lg border-2 border-dashed border-white/80 shadow-[0_0_0_100vmax_rgb(0_0_0/0.35)]" />
        )}
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

      {status === "live" && (torch.available || zoom.steps.length > 0 || lenses.list.length > 1) && (
        <div role="group" aria-label="Camera controls" className="flex flex-wrap justify-center gap-2 px-4 pt-3">
          {torch.available && (
            <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} className={pill}>
              <FlashlightIcon className="size-4" />
              {torch.on ? "Light off" : "Light"}
            </button>
          )}
          {zoom.steps.length > 0 && (
            <button type="button" onClick={() => void nextZoom()} aria-label={`Zoom ${zoom.value}×`} className={pill}>
              {zoom.value}×
            </button>
          )}
          {lenses.list.length > 1 && (
            <button type="button" onClick={() => void nextLens()} aria-label={`Switch lens (lens ${lensIndex + 1} of ${lenses.list.length})`} className={pill}>
              Lens {lensIndex + 1}/{lenses.list.length}
            </button>
          )}
        </div>
      )}

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
        </div>
        <button
          type="button"
          aria-label="Take picture"
          disabled={status !== "live" || busy || !next}
          onClick={() => void take()}
          className="size-20 rounded-full border-4 border-white bg-white/90 shadow-lg active:scale-95 disabled:opacity-40"
        />
        <div className="flex justify-end">
          {started && (
            <button type="button" onClick={retake} disabled={busy} className="h-10 rounded-lg bg-white/15 px-3 text-sm font-medium">
              Retake
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
          stopStream();
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
