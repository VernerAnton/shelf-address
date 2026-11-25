"use client";

import { useEffect, useRef, useState } from "react";
import { CoverEditor } from "@/components/cover-editor";
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

/** The picture turned a quarter: 1 clockwise (right), -1 anticlockwise (left). */
async function turned(picture: Blob, direction: 1 | -1): Promise<Blob> {
  const bitmap = await createImageBitmap(picture);
  try {
    return await render(bitmap.height, bitmap.width, (c) => {
      c.translate(bitmap.height / 2, bitmap.width / 2);
      c.rotate((direction * Math.PI) / 2);
      c.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    });
  } finally {
    bitmap.close();
  }
}

const IMAGE =
  "max-h-[70vh] w-full rounded-xl border border-line bg-line object-contain md:h-[calc(100dvh-31.5rem)] md:max-h-none md:min-h-48 md:w-auto md:max-w-[26rem] xl:h-[min(calc(100dvh_-_26rem),calc((min(100vw,96rem)_-_66rem)_*_1.45))] xl:max-w-[calc(min(100vw,96rem)_-_66rem)] 2xl:h-[min(calc(100dvh_-_22.5rem),calc((min(100vw,96rem)_-_66rem)_*_1.45))]";

/**
 * The front cover on Saved texts (docs/spec-corrections.md §28): large, to
 * judge it; Copy picture (to paste into a listing) and Download picture.
 *
 * Editing (§33): ↺ / ↻ turn it at once on screen — the turned picture is
 * made here and shown straight away, and saved in the background (one after
 * another, so quick taps can't arrive out of order). "Edit picture" opens the
 * same full-screen editor as covers in Sections: corners on the book's edges,
 * straighten and crop. "Undo last change" puts back the picture as it was
 * before the last edit. Edits are saved to the picture itself, so Copy,
 * Download and the list's thumbnail all show the edited one.
 *
 * Wide screens: the buttons sit beside the picture, so it can be as tall as
 * the whole text column. Its size is also held to the width the text column
 * can spare: the text's buttons need ~30rem to stay on one row, and the list,
 * gaps and these buttons take 66rem of the page. The heights allow for both
 * bottom rows (the tabs and Extract's own).
 */
export function CoverPanel({ text, button, onZoom, onChanged }: { text: SavedText; button: string; onZoom: (src: string) => void; onChanged: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Blob | null>(null);
  const [opening, setOpening] = useState(false);
  // The newest picture, made here and shown at once while it's saved (or just saved).
  const [local, setLocal] = useState<{ id: string; blob: Blob; url: string } | null>(null);
  // The picture before the last change, to put back (one step).
  const [undo, setUndo] = useState<{ id: string; blob: Blob } | null>(null);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const mine = local?.id === text.id ? local : null;
  const src = mine?.url ?? coverUrl(text);

  // A local picture belongs to the text it was made for; its address is freed when replaced.
  useEffect(() => {
    const url = local?.url;
    return () => {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [local?.url]);

  /** The picture as it is now: the newest made here, or the server's. */
  const current = async (): Promise<Blob> => {
    if (mine) return mine.blob;
    const response = await fetch(coverUrl(text));
    if (!response.ok) throw new Error("The picture couldn't be loaded.");
    return response.blob();
  };

  /** Shows `picture` at once and saves it in the background, after any save still under way. */
  const apply = (picture: Blob, before: Blob | null) => {
    const id = text.id;
    setLocal({ id, blob: picture, url: URL.createObjectURL(picture) });
    setUndo(before ? { id, blob: before } : null);
    setError(null);
    setSaving((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch(`/api/extract/texts/${id}/cover`, {
          method: "PUT",
          headers: { "content-type": picture.type || "image/jpeg" },
          body: picture,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Couldn't save the picture.");
        }
        await onChanged();
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } catch (e) {
        // Not saved: go back to what the server has, and say so.
        setLocal((l) => (l?.blob === picture ? null : l));
        setError(`${(e as Error).message} The change wasn't kept — try again.`);
      } finally {
        setSaving((n) => n - 1);
      }
    });
  };

  const turn = async (direction: 1 | -1) => {
    try {
      const before = await current();
      apply(await turned(before, direction), before);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openEditor = async () => {
    setOpening(true);
    try {
      setEditing(await current());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const putBack = () => {
    if (undo?.id !== text.id) return;
    apply(undo.blob, null);
  };

  const copyPicture = async () => {
    try {
      const png = current().then(async (picture) => {
        const bitmap = await createImageBitmap(picture);
        try {
          return await render(bitmap.width, bitmap.height, (c) => c.drawImage(bitmap, 0, 0), "image/png");
        } finally {
          bitmap.close();
        }
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Couldn't copy the picture. Use Download picture, or drag the picture into the other site.");
    }
  };

  return (
    <figure aria-label="Front cover" className="flex flex-col items-start gap-2 xl:flex-row">
      <button type="button" onClick={() => onZoom(src)} title="Click to see it full size" className="cursor-zoom-in">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API behind the login, or made here */}
        <img src={src} alt="Front cover" className={IMAGE} />
      </button>

      <div className="flex w-full flex-col gap-2 md:w-auto xl:w-44">
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap xl:flex-col">
          <button type="button" onClick={() => void copyPicture()} className={`${button} bg-accent text-accent-contrast`}>
            {copied ? "Picture copied ✓" : "Copy picture"}
          </button>
          <a href={src} download={fileName(text)} className={`${button} border border-line bg-surface`}>
            Download picture
          </a>
        </div>
        <div role="group" aria-label="Edit the picture" className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void turn(-1)} aria-label="Rotate left" title="Turn a quarter to the left" className={`${button} border border-line bg-surface text-xl`}>
            ↺
          </button>
          <button type="button" onClick={() => void turn(1)} aria-label="Rotate right" title="Turn a quarter to the right" className={`${button} border border-line bg-surface text-xl`}>
            ↻
          </button>
          <button
            type="button"
            disabled={opening}
            onClick={() => void openEditor()}
            className={`${button} col-span-2 border border-line bg-surface disabled:opacity-40`}
          >
            Edit picture
          </button>
          {undo?.id === text.id && (
            <button type="button" onClick={putBack} className={`${button} col-span-2 border border-line bg-surface`}>
              Undo last change
            </button>
          )}
        </div>
        <p role="status" aria-label="Picture saving" className="min-h-5 text-sm text-muted">
          {saving > 0 ? "Saving…" : saved ? "✓ Saved" : ""}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {editing && (
        <CoverEditor
          title={text.text.replace(/\s+/g, " ").slice(0, 60)}
          source={editing}
          onClose={() => setEditing(null)}
          onSave={async (picture) => apply(picture, editing)}
        />
      )}
    </figure>
  );
}
