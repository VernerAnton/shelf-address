"use client";

/**
 * The page's side of public/cover-worker.js: finds a book in a photo and
 * flattens it (docs/spec-corrections.md §15). If OpenCV can't load, detection
 * reports nothing and flattening falls back to a plain crop, so a cover can
 * always be saved.
 */

import { OPENCV_URL } from "./opencv-file";

export type Corners = [number, number][];
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Starts OpenCV in its worker (once). Resolves false if it can't run here. */
export function startVision(): Promise<boolean> {
  ready ??= new Promise<boolean>((resolve) => {
    try {
      worker = new Worker("/cover-worker.js");
    } catch {
      return resolve(false);
    }
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; id?: number; error?: string };
      if (message.type === "ready") return resolve(true);
      if (message.type === "failed") return resolve(false);
      const job = message.id ? pending.get(message.id) : undefined;
      if (!job) return;
      pending.delete(message.id!);
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message);
    };
    worker.onerror = () => resolve(false);
    worker.postMessage({ type: "init", cvUrl: OPENCV_URL });
  });
  return ready;
}

function call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...message, id }, transfer);
  });
}

/** Where the book is in `image`, or null if nothing book-shaped stands out. */
export async function detectBook(image: Pixels): Promise<Corners | null> {
  if (!(await startVision())) return null;
  try {
    return (await call<{ corners: Corners | null }>({ type: "detect", image }, [image.data.buffer])).corners;
  } catch {
    return null;
  }
}

/** The part of `image` inside `corners`, straightened. */
export async function flattenCover(image: Pixels, corners: Corners): Promise<Pixels> {
  if (await startVision()) {
    try {
      const copy = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
      return (await call<{ cover: Pixels }>({ type: "flatten", image: copy, corners }, [copy.data.buffer])).cover;
    } catch {
      // fall through to a plain crop
    }
  }
  return plainCrop(image, corners);
}

/** No OpenCV: crop to the box around the corners, without straightening. */
function plainCrop(image: Pixels, corners: Corners): Pixels {
  const xs = corners.map((c) => c[0] * image.width);
  const ys = corners.map((c) => c[1] * image.height);
  const x = Math.max(0, Math.floor(Math.min(...xs)));
  const y = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(image.width, Math.ceil(Math.max(...xs))) - x;
  const h = Math.min(image.height, Math.ceil(Math.max(...ys))) - y;
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  source.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const context = out.getContext("2d")!;
  context.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
  const data = context.getImageData(0, 0, out.width, out.height);
  return { width: data.width, height: data.height, data: data.data };
}

/**
 * Downloads OpenCV and the worker in the background while there's signal,
 * so the cover camera works the first time it's opened with none. The
 * service worker keeps them.
 */
export function prefetchVision() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const go = () => {
    for (const url of [OPENCV_URL, "/cover-worker.js", "/cover-vision.js"]) void fetch(url).catch(() => {});
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 10_000 });
  else setTimeout(go, 3000);
}
