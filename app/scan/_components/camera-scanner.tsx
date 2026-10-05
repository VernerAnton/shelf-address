"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, FlashlightIcon } from "@/components/icons";
import { backCameras, pickMainCamera, zoomSteps, type CameraDevice } from "@/lib/camera-choice";
import { formatIsbn, parseIsbn } from "@/lib/isbn";
import type { FoundIsbn } from "@/lib/isbn-text";
import { onCameraClaims } from "@/lib/client/camera";
import { readIsbnsFromPhoto, warmOcr } from "@/lib/client/ocr";

type Props = {
  disabled: boolean;
  onIsbn: (isbn13: string) => void;
  /** Start the camera as soon as the screen opens (Evaluate), instead of on a tap. */
  autoStart?: boolean;
};

/**
 * Live barcode scanning with @zxing/library (spec §6) — not the native
 * BarcodeDetector, which Safari/iOS doesn't support.
 *
 * Continuous mode. A barcode is logged once while it stays in view; take it
 * away for a moment and show it again to log another copy of the same book.
 *
 * Help for weaker phone cameras (docs/spec-corrections.md §18):
 * - the main back lens is chosen on purpose (lib/camera-choice.ts), with a
 *   lens button to try the others; the choice is remembered on the phone;
 * - continuous autofocus is asked for where the camera supports it;
 * - a zoom button, so a book can be held far enough away to focus;
 * - photos are decoded with the library's "try harder" mode (it can't be
 *   used live: in @zxing/library 0.21 it silently stops the live decoder);
 * - "Take a photo" uses the phone's own camera app, which focuses better
 *   than a browser, and reads the barcode from the photo;
 * - zoom and the light are remembered on the phone and come back whenever
 *   the camera starts again (e.g. back from Antikvaari), like the lens.
 *
 * Covered barcodes (§19): if a photo has no barcode, the printed ISBN is read
 * from it instead — a photo of the copyright page. A page listing several
 * ISBNs (hardback, paperback…) asks which one.
 */
const GONE_AFTER_MS = 1500;
const CAMERA_KEY = "scanner:camera";
const ZOOM_KEY = "scanner:zoom";
const TORCH_KEY = "scanner:torch";

type Reader = import("@zxing/library").BrowserMultiFormatReader;
type Caps = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number }; focusMode?: string[] };

function beep(audio: AudioContext | null) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 1320;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.07);
}

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
    // Private mode etc.: the setting just isn't remembered.
  }
}

async function videoInputs(): Promise<CameraDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/**
 * Book barcodes only (EAN-13). `thorough` turns on "try harder" — for still
 * photos only: in @zxing/library 0.21 it silently stops live decoding.
 */
async function makeReader(thorough = false): Promise<Reader> {
  const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import("@zxing/library");
  // Restricting the format also means the small price add-on beside a book's barcode is ignored.
  const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]],
  ]);
  if (thorough) hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, 200);
}

/**
 * Reads a barcode from a photo. Phone photos are huge (50 MP on a Galaxy
 * A26), so it's tried at a few sizes, and turned sideways in case the
 * book was photographed on its side.
 */
async function decodePhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const reader = await makeReader(true);
  try {
    for (const side of [1600, 2400, 1000]) {
      for (const turn of [0, 90]) {
        const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = turn ? h : w;
        canvas.height = turn ? w : h;
        const context = canvas.getContext("2d")!;
        if (turn) {
          context.translate(h, 0);
          context.rotate(Math.PI / 2);
        }
        context.drawImage(bitmap, 0, 0, w, h);
        try {
          const result = await reader.decodeFromImageUrl(canvas.toDataURL("image/jpeg", 0.92));
          return result.getText();
        } catch {
          // Not found at this size and angle: try the next.
        }
      }
    }
    return null;
  } finally {
    bitmap.close();
    reader.reset();
  }
}

export function CameraScanner({ disabled, onIsbn, autoStart = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ code: string; seenAt: number } | null>(null);
  const onIsbnRef = useRef(onIsbn);
  useEffect(() => {
    onIsbnRef.current = onIsbn;
  }, [onIsbn]);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [lenses, setLenses] = useState<{ list: CameraDevice[]; current: string | null }>({ list: [], current: null });
  const [zoom, setZoom] = useState<{ steps: number[]; value: number }>({ steps: [], value: 1 });
  const [choices, setChoices] = useState<FoundIsbn[] | null>(null);

  // Load the decoder in the background as soon as the screen opens, so the
  // service worker has it cached before the phone goes out of signal; the
  // text reader for covered barcodes a little later, once.
  useEffect(() => {
    void import("@zxing/library");
    const timer = setTimeout(warmOcr, 5000);
    return () => clearTimeout(timer);
  }, []);

  const stop = useCallback(() => {
    readerRef.current?.reset();
    readerRef.current = null;
    setRunning(false);
    setTorch({ available: false, on: false });
    setZoom({ steps: [], value: 1 });
  }, []);

  const handleCode = useCallback((code: string) => {
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.code === code && now - last.seenAt < GONE_AFTER_MS) {
      last.seenAt = now; // still the same book in view — don't log it again
      return;
    }
    lastRef.current = { code, seenAt: now };

    const parsed = parseIsbn(code);
    if (!parsed.ok) {
      setNotice(parsed.reason);
      return;
    }
    setNotice(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    navigator.vibrate?.(60);
    beep(audioRef.current);
    onIsbnRef.current(parsed.isbn13);
  }, []);

  const currentTrack = () => (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];

  /** Opens one camera (a lens by id, or just "the back one") and starts decoding. */
  const open = useCallback(
    async (deviceId: string | null) => {
      readerRef.current?.reset();
      const reader = await makeReader();
      readerRef.current = reader;
      await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
            // Full HD: small barcodes (pocket books) need the pixels.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        videoRef.current!,
        (result) => {
          if (result) handleCode(result.getText());
        },
      );
    },
    [handleCode],
  );

  /**
   * Once a camera is running: autofocus, what the light, zoom and lens buttons
   * can offer, and the zoom and light as they were last left.
   */
  const tune = useCallback(async () => {
    const track = currentTrack();
    const caps = track?.getCapabilities?.() as Caps | undefined;
    if (track && caps?.focusMode?.includes("continuous")) {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
    }
    let lit = false;
    if (track && caps?.torch && stored(TORCH_KEY) === "on") {
      lit = await track
        .applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
        .then(() => true, () => false);
    }
    setTorch({ available: Boolean(caps?.torch), on: lit });
    const steps = zoomSteps(caps?.zoom ?? null);
    const settings = track?.getSettings() as (MediaTrackSettings & { zoom?: number }) | undefined;
    let value = settings?.zoom ?? 1;
    const wanted = Number(stored(ZOOM_KEY));
    if (track && steps.includes(wanted) && wanted !== value) {
      value = await track
        .applyConstraints({ advanced: [{ zoom: wanted } as MediaTrackConstraintSet] })
        .then(() => wanted, () => value);
    }
    setZoom({ steps, value });
    setLenses({ list: backCameras(await videoInputs()), current: settings?.deviceId ?? null });
  }, []);

  const start = useCallback(
    async (lens?: string) => {
      setError(null);
      setNotice(null);
      setStarting(true);
      // Created inside the tap so iOS allows it to make sound later.
      try {
        audioRef.current ??= new AudioContext();
      } catch {
        audioRef.current = null;
      }
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("no mediaDevices"), { name: "NotSupportedError" });
        }
        // The lens asked for, else the one chosen last time, else the main back lens if
        // the labels say which (they only do once the camera has been allowed).
        const devices = await videoInputs();
        const known = (id: string | null) => (id && devices.some((d) => d.deviceId === id) ? id : null);
        const wanted = known(lens ?? null) ?? known(stored(CAMERA_KEY)) ?? pickMainCamera(devices);
        try {
          await open(wanted);
        } catch (e) {
          if (!wanted) throw e;
          store(CAMERA_KEY, null); // that lens is gone or busy: fall back to "the back camera"
          await open(null);
        }
        if (!wanted) {
          // First time: now the labels are known, switch to the main lens if this isn't it.
          const main = pickMainCamera(await videoInputs());
          if (main && main !== currentTrack()?.getSettings().deviceId) {
            await open(main).catch(() => open(null));
          }
        }
        setRunning(true);
        await tune();
      } catch (e) {
        stop();
        const name = (e as { name?: string })?.name;
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera access was refused. Allow the camera for this site in your phone's settings, or type the ISBN below."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera found. Type the ISBN below instead."
              : name === "NotSupportedError"
                ? "This browser can't use the camera here. Type the ISBN below instead."
                : "The camera couldn't start. Try again, or type the ISBN below.",
        );
      } finally {
        setStarting(false);
      }
    },
    [open, stop, tune],
  );

  const toggleTorch = useCallback(async () => {
    const track = currentTrack();
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ available: true, on });
      store(TORCH_KEY, on ? "on" : null);
    } catch {
      setTorch({ available: false, on: false });
    }
  }, [torch.on]);

  const nextZoom = useCallback(async () => {
    const track = currentTrack();
    if (!track || zoom.steps.length === 0) return;
    const i = zoom.steps.indexOf(zoom.value);
    const value = zoom.steps[(i + 1) % zoom.steps.length];
    try {
      await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoom((z) => ({ ...z, value }));
      store(ZOOM_KEY, value === 1 ? null : String(value));
    } catch {
      setZoom({ steps: [], value: 1 });
    }
  }, [zoom]);

  /** Tries the next back lens, and remembers it on this phone. */
  const nextLens = useCallback(async () => {
    const { list, current } = lenses;
    if (list.length < 2) return;
    const i = list.findIndex((d) => d.deviceId === current);
    const next = list[(i + 1) % list.length].deviceId;
    store(CAMERA_KEY, next);
    await start(next);
  }, [lenses, start]);

  /**
   * "Take a photo": the phone's own camera app, then the barcode read from
   * the photo — or, if there's none (covered by a sticker), the ISBN printed
   * on the page.
   */
  const onPhoto = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setReading(true);
      setNotice(null);
      setError(null);
      setChoices(null);
      try {
        lastRef.current = null; // a photo always counts, even of the book just scanned
        const code = await decodePhoto(file).catch(() => null);
        if (code) return handleCode(code);
        let found: FoundIsbn[];
        try {
          found = await readIsbnsFromPhoto(file);
        } catch {
          setNotice(
            navigator.onLine
              ? "Couldn't read that photo. Try again, or type the ISBN."
              : "No barcode in that photo. Reading a printed ISBN needs signal the first time (a one-time download). Type the ISBN for now.",
          );
          return;
        }
        if (found.length === 1) handleCode(found[0].isbn13);
        else if (found.length > 1) setChoices(found);
        else {
          setNotice(
            "Couldn't find a barcode or an ISBN in that photo. Try again closer, with the ISBN line sharp and well lit, or type the ISBN.",
          );
        }
      } finally {
        setReading(false);
        if (photoRef.current) photoRef.current.value = "";
      }
    },
    [handleCode],
  );

  // Release the camera when the app goes to the background or the screen
  // is left; pick up again when it comes back.
  useEffect(() => {
    let resume = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && readerRef.current) {
        resume = true;
        stop();
      } else if (document.visibilityState === "visible" && resume) {
        resume = false;
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      readerRef.current?.reset();
    };
  }, [start, stop]);

  useEffect(() => {
    if (disabled && readerRef.current) stop();
  }, [disabled, stop]);

  useEffect(() => {
    // Deferred a tick so the video element is mounted and state isn't set mid-render.
    if (!autoStart || disabled) return;
    const timer = setTimeout(() => void start(), 0);
    return () => clearTimeout(timer);
  }, [autoStart, disabled, start]);

  // The cover camera needs the camera for a moment; hand it over and resume.
  useEffect(() => {
    let resume = false;
    return onCameraClaims({
      claim: () => {
        if (readerRef.current) {
          resume = true;
          stop();
        }
      },
      release: () => {
        if (resume) {
          resume = false;
          void start();
        }
      },
    });
  }, [start, stop]);

  const lensIndex = lenses.list.findIndex((d) => d.deviceId === lenses.current);
  const pill = "flex h-10 items-center gap-1.5 rounded-full bg-black/60 px-3 text-sm text-white";

  return (
    <section aria-label="Camera scanner" className="flex flex-col gap-3">
      <div
        className={`relative aspect-[4/3] overflow-hidden rounded-xl bg-black transition-shadow ${
          flash ? "shadow-[0_0_0_4px_rgb(16_185_129)]" : ""
        } ${running ? "" : "hidden"}`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
          aria-label="Camera view"
        />
        {/* Aim guide: book barcodes are wide and short. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[12%] top-1/2 h-[28%] -translate-y-1/2 rounded-lg border-2 border-white/80" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-between gap-2 p-2">
          <span className="flex gap-2">
            {torch.available && (
              <button type="button" onClick={toggleTorch} aria-pressed={torch.on} className={pill}>
                <FlashlightIcon className="size-4" />
                {torch.on ? "Light off" : "Light"}
              </button>
            )}
            {zoom.steps.length > 0 && (
              <button type="button" onClick={nextZoom} aria-label={`Zoom ${zoom.value}×`} className={pill}>
                {zoom.value}×
              </button>
            )}
            {lenses.list.length > 1 && (
              <button
                type="button"
                onClick={nextLens}
                aria-label={`Switch lens (lens ${lensIndex + 1} of ${lenses.list.length})`}
                className={pill}
              >
                Lens {lensIndex + 1}/{lenses.list.length}
              </button>
            )}
          </span>
          <button type="button" onClick={stop} className="h-10 rounded-full bg-black/60 px-4 text-sm text-white">
            Stop camera
          </button>
        </div>
      </div>

      {!running && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={disabled || starting}
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-accent text-lg font-medium text-accent-contrast disabled:opacity-40"
        >
          <CameraIcon className="size-6" />
          {starting ? "Starting camera…" : "Scan with camera"}
        </button>
      )}

      {running && (
        <p className="text-center text-sm text-muted">
          Point at the barcode on the back. To log another copy of the same book, move it away
          and back.
          {zoom.steps.length > 0 && " Blurry? Hold the book further away and zoom in."}
        </p>
      )}

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Barcode photo"
        tabIndex={-1}
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled || reading}
        onClick={() => {
          // The phone's camera app can't open while this page holds the camera.
          if (readerRef.current) stop();
          photoRef.current?.click();
        }}
        className="h-11 rounded-xl border border-line bg-surface text-sm font-medium disabled:opacity-40"
      >
        {reading ? "Reading the photo…" : "Camera struggling? Take a photo"}
      </button>
      {!reading && !choices && (
        <p className="-mt-1 text-center text-xs text-muted">
          Of the barcode — or if it&apos;s covered, of the page with the ISBN (usually the back of the title page).
        </p>
      )}

      {choices && (
        <section aria-label="ISBNs in the photo" className="flex flex-col gap-2 rounded-xl border-2 border-accent bg-surface p-3">
          <p className="text-sm font-medium">This page lists {choices.length} ISBNs. Which is the book in your hand?</p>
          {choices.map((c) => (
            <button
              key={c.isbn13}
              type="button"
              onClick={() => {
                setChoices(null);
                lastRef.current = null;
                handleCode(c.isbn13);
              }}
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left active:bg-line/50"
            >
              <span className="font-mono font-medium">{formatIsbn(c.isbn13)}</span>
              {c.label && <span className="min-w-0 truncate text-sm text-muted">{c.label}</span>}
            </button>
          ))}
          <button type="button" onClick={() => setChoices(null)} className="h-10 text-sm text-muted">
            None of these
          </button>
        </section>
      )}

      {notice && (
        <p role="status" className="rounded-lg border border-warn-line bg-warn-bg p-2 text-center text-sm text-warn-text">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
