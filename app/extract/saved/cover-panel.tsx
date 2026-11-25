"use client";

import { useRef, useState } from "react";
import type { SavedText } from "@/lib/saved-texts";

/** The front cover's address; a new photo has a new one, so it's never an old copy from the cache. */
export const coverUrl = (t: SavedText) => `/api/extract/texts/${t.id}/cover?v=${encodeURIComponent(t.coverAt ?? "")}`;

/** "etukansi-vaino-linnan-romaani.jpg": the picture's file name, from the text's first words. */
const fileName = (t: SavedText) =>
  `etukansi-${
    t.text
      .replace(/\s+/g, " ")
      .slice(0, 90)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "kirja"
  }.jpg`;

async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

async function fetchCover(t: SavedText): Promise<Blob> {
  const response = await fetch(coverUrl(t));
  if (!response.ok) throw new Error("The picture couldn't be loaded.");
  return response.blob();
}

/** Draws onto a fresh canvas and gives back a JPEG (or PNG, for the clipboard). */
async function render(width: number, height: number, draw: (c: CanvasRenderingContext2D) => void, type = "image/jpeg"): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  draw(context);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("The picture couldn't be made.");
  return blob;
}

/** The front cover as a PNG: what a clipboard takes, everywhere. */
async function asPng(t: SavedText): Promise<Blob> {
  const bitmap = await bitmapOf(await fetchCover(t));
  try {
    return await render(bitmap.width, bitmap.height, (c) => c.drawImage(bitmap, 0, 0), "image/png");
  } finally {
    bitmap.close();
  }
}

/** A crop being chosen: the corners, as fractions of the picture element's box (0–1). */
type Selection = { x0: number; y0: number; x1: number; y1: number };

const IMAGE =
  "max-h-[70vh] w-full rounded-xl border border-line bg-line object-contain md:h-[calc(100dvh-31.5rem)] md:max-h-none md:min-h-48 md:w-auto md:max-w-[26rem] xl:h-[min(calc(100dvh_-_26rem),calc((min(100vw,96rem)_-_66rem)_*_1.45))] xl:max-w-[calc(min(100vw,96rem)_-_66rem)] 2xl:h-[min(calc(100dvh_-_22.5rem),calc((min(100vw,96rem)_-_66rem)_*_1.45))]";

/**
 * The front cover on Saved texts (docs/spec-corrections.md §28): large, to
 * judge it; Copy picture (to paste into a listing) and Download picture; and
 * since V33.1 a small editor — turn it a quarter either way, crop it, undo
 * the last change. Edits are saved to the picture itself (on the server), so
 * Copy, Download and the list's thumbnail all show the edited one.
 *
 * Wide screens: the buttons sit beside the picture, so it can be as tall as
 * the whole text column. Its size is also held to the width the text column
 * can spare: the text's buttons need ~30rem to stay on one row, and the list,
 * gaps and these buttons take 66rem of the page. The heights allow for both
 * bottom rows (the tabs and Extract's own).
 */
export function CoverPanel({ text, button, onZoom, onChanged }: { text: SavedText; button: string; onZoom: () => void; onChanged: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  // The picture before the last change, to put back (one step).
  const [undo, setUndo] = useState<{ id: string; blob: Blob } | null>(null);
  const dragging = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const copyPicture = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": asPng(text) })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Couldn't copy the picture. Use Download picture, or drag the picture into the other site.");
    }
  };

  /** Saves a new version of the picture; the one before can be put back with Undo. */
  const save = async (blob: Blob, before: Blob | null) => {
    const response = await fetch(`/api/extract/texts/${text.id}/cover`, {
      method: "PUT",
      headers: { "content-type": blob.type || "image/jpeg" },
      body: blob,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Couldn't save the picture.");
    }
    setUndo(before ? { id: text.id, blob: before } : null);
    await onChanged();
  };

  const edit = async (make: (original: Blob) => Promise<Blob>) => {
    setBusy(true);
    setError(null);
    try {
      const original = await fetchCover(text);
      await save(await make(original), original);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** A quarter turn: 1 clockwise (right), -1 anticlockwise (left). */
  const rotate = (direction: 1 | -1) =>
    edit(async (original) => {
      const bitmap = await bitmapOf(original);
      try {
        return await render(bitmap.height, bitmap.width, (c) => {
          c.translate(bitmap.height / 2, bitmap.width / 2);
          c.rotate((direction * Math.PI) / 2);
          c.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        });
      } finally {
        bitmap.close();
      }
    });

  /** Saves the chosen crop, mapped from the element's box to the picture's own pixels (it's shown "contained"). */
  const saveCrop = async () => {
    const img = imgRef.current;
    if (!img || !selection) return;
    const boxW = img.clientWidth;
    const boxH = img.clientHeight;
    const ok = await edit(async (original) => {
      const bitmap = await bitmapOf(original);
      try {
        const scale = Math.min(boxW / bitmap.width, boxH / bitmap.height);
        const offX = (boxW - bitmap.width * scale) / 2;
        const offY = (boxH - bitmap.height * scale) / 2;
        const toX = (f: number) => Math.min(bitmap.width, Math.max(0, (f * boxW - offX) / scale));
        const toY = (f: number) => Math.min(bitmap.height, Math.max(0, (f * boxH - offY) / scale));
        const x = toX(Math.min(selection.x0, selection.x1));
        const y = toY(Math.min(selection.y0, selection.y1));
        const w = toX(Math.max(selection.x0, selection.x1)) - x;
        const h = toY(Math.max(selection.y0, selection.y1)) - y;
        if (w < 40 || h < 40) throw new Error("That's too small — drag across the part of the picture to keep.");
        return await render(Math.round(w), Math.round(h), (c) => c.drawImage(bitmap, x, y, w, h, 0, 0, Math.round(w), Math.round(h)));
      } finally {
        bitmap.close();
      }
    });
    if (ok) {
      setCropping(false);
      setSelection(null);
    }
  };

  const putBack = async () => {
    if (!undo || undo.id !== text.id) return;
    setBusy(true);
    setError(null);
    try {
      await save(undo.blob, null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const shown = selection && {
    left: `${Math.min(selection.x0, selection.x1) * 100}%`,
    top: `${Math.min(selection.y0, selection.y1) * 100}%`,
    width: `${Math.abs(selection.x1 - selection.x0) * 100}%`,
    height: `${Math.abs(selection.y1 - selection.y0) * 100}%`,
  };

  return (
    <figure aria-label="Front cover" className="flex flex-col items-start gap-2 xl:flex-row">
      {cropping ? (
        <div className="relative overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API behind the login */}
          <img ref={imgRef} src={coverUrl(text)} alt="Front cover" draggable={false} className={IMAGE} />
          <div
            role="presentation"
            aria-label="Crop area"
            className="absolute inset-0 cursor-crosshair touch-none select-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              const p = point(e);
              setSelection({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              const p = point(e);
              setSelection((s) => (s ? { ...s, x1: p.x, y1: p.y } : s));
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
          >
            {shown && (
              <div
                aria-label="Chosen part"
                className="pointer-events-none absolute border-2 border-dashed border-white"
                style={{ ...shown, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
              />
            )}
          </div>
        </div>
      ) : (
        <button type="button" onClick={onZoom} title="Click to see it full size" className="cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API behind the login */}
          <img src={coverUrl(text)} alt="Front cover" className={IMAGE} />
        </button>
      )}

      <div className="flex w-full flex-col gap-2 md:w-auto xl:w-44">
        {cropping ? (
          <>
            <p className="text-sm text-muted">Drag across the picture to choose the part to keep.</p>
            <button
              type="button"
              disabled={!selection || busy}
              onClick={() => void saveCrop()}
              className={`${button} bg-accent text-accent-contrast disabled:opacity-40`}
            >
              {busy ? "Saving…" : "Save crop"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCropping(false);
                setSelection(null);
                setError(null);
              }}
              className={`${button} border border-line bg-surface`}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap xl:flex-col">
              <button type="button" onClick={() => void copyPicture()} className={`${button} bg-accent text-accent-contrast`}>
                {copied ? "Picture copied ✓" : "Copy picture"}
              </button>
              <a href={coverUrl(text)} download={fileName(text)} className={`${button} border border-line bg-surface`}>
                Download picture
              </a>
            </div>
            <div role="group" aria-label="Edit the picture" className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void rotate(-1)}
                aria-label="Rotate left"
                title="Turn a quarter to the left"
                className={`${button} border border-line bg-surface text-xl disabled:opacity-40`}
              >
                ↺
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void rotate(1)}
                aria-label="Rotate right"
                title="Turn a quarter to the right"
                className={`${button} border border-line bg-surface text-xl disabled:opacity-40`}
              >
                ↻
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCropping(true);
                  setSelection(null);
                  setError(null);
                }}
                className={`${button} col-span-2 border border-line bg-surface disabled:opacity-40`}
              >
                Crop
              </button>
              {undo?.id === text.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void putBack()}
                  className={`${button} col-span-2 border border-line bg-surface disabled:opacity-40`}
                >
                  Undo last change
                </button>
              )}
            </div>
            {busy && (
              <p role="status" className="text-sm text-muted">
                Saving the picture…
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </figure>
  );
}
