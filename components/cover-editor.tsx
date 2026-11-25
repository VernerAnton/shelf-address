"use client";

import { useEffect, useRef, useState } from "react";
import { CornerEditor, pixelsOf, toBlob, toCanvas } from "@/components/cover-camera";
import { detectBook, flattenCover, startVision, type Corners, type Pixels } from "@/lib/client/cover-vision";

/** The whole picture, as corners (top-left, top-right, bottom-right, bottom-left). */
const WHOLE: Corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const DETECT_SIDE = 480;

const same = (a: Corners, b: Corners) => a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-6 && Math.abs(p[1] - b[i][1]) < 1e-6);

/** The picture turned a quarter: 1 clockwise, -1 anticlockwise. */
function turnPixels(photo: Pixels, direction: 1 | -1): Pixels {
  const source = toCanvas(photo);
  const canvas = document.createElement("canvas");
  canvas.width = photo.height;
  canvas.height = photo.width;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((direction * Math.PI) / 2);
  context.drawImage(source, -photo.width / 2, -photo.height / 2);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  source.width = source.height = canvas.width = canvas.height = 0;
  return { width: data.width, height: data.height, data: data.data };
}

/** The corners turned with the picture, still in the order top-left, top-right, bottom-right, bottom-left. */
function turnCorners(c: Corners, direction: 1 | -1): Corners {
  const at = (p: [number, number]): [number, number] => (direction === 1 ? [1 - p[1], p[0]] : [p[1], 1 - p[0]]);
  // Clockwise, the old bottom-left becomes the top-left; anticlockwise, the old top-right does.
  const order = direction === 1 ? [3, 0, 1, 2] : [1, 2, 3, 0];
  return order.map((i) => at(c[i] as [number, number])) as Corners;
}

type Loaded = { photo: Pixels; url: string; corners: Corners; found: boolean; turned: boolean };

/**
 * Editing a front cover on Saved texts (docs/spec-corrections.md §33): the
 * same full-screen editor as photographing a cover in Sections (§15) — four
 * corner handles, which start on the book's edges if it can find them, with a
 * magnifier under the one being dragged; saving straightens and crops to
 * them — plus turning a quarter either way (at once, on screen) and "Whole
 * picture" to start the corners from the edges again. Nothing is saved until
 * Save picture; the picture keeps its full resolution.
 */
export function CoverEditor({ title, source, onSave, onClose }: { title: string; source: Blob; onSave: (picture: Blob) => Promise<void>; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [finding, setFinding] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const moved = useRef(false);

  const show = async (photo: Pixels) => {
    const url = URL.createObjectURL(await toBlob(toCanvas(photo), "image/jpeg", 0.9));
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    return url;
  };
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Open: the picture at full size, corners on its edges; then look for the book in it.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const bitmap = await createImageBitmap(source);
        const photo = pixelsOf(bitmap, bitmap.width, bitmap.height, Infinity);
        bitmap.close();
        const url = await show(photo);
        if (!alive) return;
        setLoaded({ photo, url, corners: WHOLE, found: false, turned: false });
        const ready = await startVision();
        const book = ready ? await detectBook(pixelsOf(toCanvas(photo), photo.width, photo.height, DETECT_SIDE)) : null;
        // Only if the corners haven't been touched meanwhile.
        if (alive && book && !moved.current) setLoaded((l) => (l ? { ...l, corners: book, found: true } : l));
      } catch {
        if (alive) setError("The picture couldn't be opened.");
      } finally {
        if (alive) setFinding(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the picture it opened with
  }, []);

  // Esc closes without saving.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const turn = async (direction: 1 | -1) => {
    if (!loaded) return;
    const photo = turnPixels(loaded.photo, direction);
    const corners = turnCorners(loaded.corners, direction);
    // Shown at once: the turned picture and its corners together.
    setLoaded({ ...loaded, photo, corners, url: await show(photo), turned: true });
  };

  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setError(null);
    try {
      const whole = same(loaded.corners, WHOLE);
      if (whole && !loaded.turned) return onClose(); // nothing changed
      const picture = whole ? loaded.photo : await flattenCover(loaded.photo, loaded.corners);
      await onSave(await toBlob(toCanvas(picture), "image/jpeg", 0.92));
      onClose();
    } catch (e) {
      setError((e as Error)?.message || "Couldn't save the picture. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const tool = "h-10 rounded-full bg-white/15 px-4 text-sm disabled:opacity-40";

  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit the front cover of ${title}`} className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <p className="min-w-0 flex-1 truncate font-medium">Front cover of {title}</p>
        <button type="button" onClick={onClose} disabled={saving} className="h-10 shrink-0 rounded-full bg-white/15 px-4 text-sm">
          Close
        </button>
      </div>
      {loaded ? (
        <CornerEditor
          photo={loaded.photo}
          url={loaded.url}
          corners={loaded.corners}
          found={loaded.found}
          saving={saving}
          onCorners={(corners) => {
            moved.current = true;
            setLoaded({ ...loaded, corners });
          }}
          onRetake={onClose}
          onSave={() => void save()}
          error={error}
          retakeLabel="Cancel"
          saveLabel="Save picture"
          hint={
            finding
              ? "Looking for the book's edges… You can drag the corners meanwhile."
              : loaded.found
                ? "The corners are on the book's edges — drag any that aren't. Saving straightens and crops to them."
                : "Drag the corners to crop — saving straightens the picture to them. Or just turn it."
          }
          tools={
            <div role="group" aria-label="Edit the picture" className="flex flex-wrap justify-center gap-2 px-4 pb-3">
              <button type="button" disabled={saving} onClick={() => void turn(-1)} aria-label="Rotate left" title="Turn a quarter to the left" className={tool}>
                ↺ Left
              </button>
              <button type="button" disabled={saving} onClick={() => void turn(1)} aria-label="Rotate right" title="Turn a quarter to the right" className={tool}>
                Right ↻
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  moved.current = true;
                  setLoaded({ ...loaded, corners: WHOLE });
                }}
                className={tool}
              >
                Whole picture
              </button>
            </div>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p role={error ? "alert" : "status"} className="p-6 text-center text-sm text-white/80">
            {error ?? "Opening the picture…"}
          </p>
        </div>
      )}
    </div>
  );
}
