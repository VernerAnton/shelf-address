"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, FlashlightIcon } from "@/components/icons";
import { parseIsbn } from "@/lib/isbn";
import { onCameraClaims } from "@/lib/client/camera";

type Props = {
  disabled: boolean;
  onIsbn: (isbn13: string) => void;
};

/**
 * Live barcode scanning with @zxing/library (spec §6) — not the native
 * BarcodeDetector, which Safari/iOS doesn't support.
 *
 * Continuous mode. A barcode is logged once while it stays in view; take it
 * away for a moment and show it again to log another copy of the same book.
 */
const GONE_AFTER_MS = 1500;

type Reader = import("@zxing/library").BrowserMultiFormatReader;

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

export function CameraScanner({ disabled, onIsbn }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastRef = useRef<{ code: string; seenAt: number } | null>(null);
  const onIsbnRef = useRef(onIsbn);
  useEffect(() => {
    onIsbnRef.current = onIsbn;
  }, [onIsbn]);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });

  // Load the decoder in the background as soon as the screen opens, so the
  // service worker has it cached before the phone goes out of signal.
  useEffect(() => {
    void import("@zxing/library");
  }, []);

  const stop = useCallback(() => {
    readerRef.current?.reset();
    readerRef.current = null;
    setRunning(false);
    setTorch({ available: false, on: false });
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

  const start = useCallback(async () => {
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
      const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import("@zxing/library");
      // Book barcodes are EAN-13 only. Restricting the format makes decoding
      // faster and means the small price add-on barcode beside it is ignored.
      const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]],
      ]);
      const reader = new BrowserMultiFormatReader(hints, 200);
      readerRef.current = reader;
      await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current!,
        (result) => {
          if (result) handleCode(result.getText());
        },
      );
      setRunning(true);

      const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorch({ available: Boolean(caps?.torch), on: false });
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
  }, [handleCode, stop]);

  const toggleTorch = useCallback(async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ available: true, on });
    } catch {
      setTorch({ available: false, on: false });
    }
  }, [torch.on]);

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
        <div className="absolute inset-x-0 bottom-0 flex justify-between gap-2 p-2">
          {torch.available ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch.on}
              className="flex h-10 items-center gap-1.5 rounded-full bg-black/60 px-3 text-sm text-white"
            >
              <FlashlightIcon className="size-4" />
              {torch.on ? "Light off" : "Light"}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={stop}
            className="h-10 rounded-full bg-black/60 px-4 text-sm text-white"
          >
            Stop camera
          </button>
        </div>
      </div>

      {!running && (
        <button
          type="button"
          onClick={start}
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
        </p>
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
