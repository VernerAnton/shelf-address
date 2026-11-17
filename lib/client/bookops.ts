"use client";

/**
 * The browser's side of BookOps (docs/spec-corrections.md §27): turning what
 * the camera sees into photos, reading the barcode off the back-cover photo,
 * and talking to BookOps' API.
 */

import type { BookOpsBook } from "@/lib/bookops-model";
import { parseIsbn } from "@/lib/isbn";

/** Photos are stored and sent to the AI at most this big: plenty for small print, quick to upload. */
const PHOTO_SIDE = 2000;
/** A chosen photo file is worked on at most this big (phone photos can be 50 MP). */
const WORK_SIDE = 3200;

function canvasOf(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * How the camera's picture is shown and saved (docs/spec-corrections.md §27):
 * - shape "upright": a book-shaped 3:4 portrait cut from the middle of the
 *   picture (a webcam is wide, a book is tall); "whole": all of it;
 * - zoom: 1 = as large as fits, 2 = half as wide and high (digital zoom: it
 *   uses fewer of the camera's pixels);
 * - turn: for a webcam mounted on its side — then a portrait uses the
 *   camera's full width, much sharper.
 * What's shown is exactly what's saved.
 */
export type CameraView = { shape: "upright" | "whole"; zoom: number; turn: 0 | 90 | 180 | 270 };
export const DEFAULT_VIEW: CameraView = { shape: "upright", zoom: 1, turn: 0 };
export const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];

/** The part of the (turned) picture that's shown and saved, in the turned picture's pixels. */
export function viewRect(videoWidth: number, videoHeight: number, view: CameraView) {
  const sideways = view.turn % 180 !== 0;
  const w = sideways ? videoHeight : videoWidth;
  const h = sideways ? videoWidth : videoHeight;
  let cw = w / view.zoom;
  let ch = h / view.zoom;
  if (view.shape === "upright") {
    if (cw / ch > 3 / 4) cw = (ch * 3) / 4;
    else ch = (cw * 4) / 3;
  }
  return { turnedWidth: w, turnedHeight: h, x: (w - cw) / 2, y: (h - ch) / 2, width: cw, height: ch };
}

/** Draws the view of the camera's current picture into `canvas`, at most `maxSide` pixels on its longer side. */
export function drawView(video: HTMLVideoElement, view: CameraView, canvas: HTMLCanvasElement, maxSide: number): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  const r = viewRect(vw, vh, view);
  const k = Math.min(1, maxSide / Math.max(r.width, r.height));
  const width = Math.max(1, Math.round(r.width * k));
  const height = Math.max(1, Math.round(r.height * k));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.save();
  context.scale(k, k);
  context.translate(-r.x, -r.y);
  // Turned clockwise by `turn` degrees.
  if (view.turn === 90) {
    context.translate(r.turnedWidth, 0);
    context.rotate(Math.PI / 2);
  } else if (view.turn === 180) {
    context.translate(r.turnedWidth, r.turnedHeight);
    context.rotate(Math.PI);
  } else if (view.turn === 270) {
    context.translate(0, r.turnedHeight);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(video, 0, 0, vw, vh);
  context.restore();
  return true;
}

/** What the camera shows right now, as the view shows it, at the camera's full sharpness. Null before the first picture arrives. */
export function frameOf(video: HTMLVideoElement, view: CameraView = DEFAULT_VIEW): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  return drawView(video, view, canvas, WORK_SIDE) ? canvas : null;
}

/** A photo file (from the phone's camera app, or chosen on the computer), ready to work on. */
export async function canvasOfFile(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    return canvasOf(bitmap, bitmap.width, bitmap.height, WORK_SIDE);
  } finally {
    bitmap.close();
  }
}

/** The picture as a JPEG small enough to store and to send to the AI. */
export async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const out = canvasOf(canvas, canvas.width, canvas.height, PHOTO_SIDE);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.85));
  out.width = out.height = 0;
  if (!blob) throw new Error("Couldn't prepare the photo");
  return blob;
}

/**
 * The book's ISBN from the barcode in a photo of its back, or null. Tried at
 * a few sizes and turned sideways, in "try harder" mode (as the scanner does
 * for photos). Only a real book barcode counts: a price label's is ignored.
 */
export async function readBarcode(canvas: HTMLCanvasElement): Promise<string | null> {
  const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import("@zxing/library");
  const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new BrowserMultiFormatReader(hints, 200);
  try {
    for (const side of [1600, 2400, 1000]) {
      for (const turn of [0, 90]) {
        const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
        const w = Math.round(canvas.width * scale);
        const h = Math.round(canvas.height * scale);
        const work = document.createElement("canvas");
        work.width = turn ? h : w;
        work.height = turn ? w : h;
        const context = work.getContext("2d");
        if (!context) return null;
        if (turn) {
          context.translate(h, 0);
          context.rotate(Math.PI / 2);
        }
        context.drawImage(canvas, 0, 0, w, h);
        const url = work.toDataURL("image/jpeg", 0.92);
        work.width = work.height = 0;
        try {
          const parsed = parseIsbn((await reader.decodeFromImageUrl(url)).getText());
          if (parsed.ok) return parsed.isbn13;
        } catch {
          // Not found at this size and angle: try the next.
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

/** Why a request to BookOps failed; `loggedOut` when it wants the access code again. */
export class BookOpsApiError extends Error {
  constructor(
    message: string,
    readonly loggedOut = false,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/extract/bookops${path}`, { cache: "no-store", ...init });
  } catch {
    throw new BookOpsApiError("No connection.");
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new BookOpsApiError(body?.error ?? `Error ${response.status}.`, response.status === 401);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type One = { book: BookOpsBook };

export const bookOps = {
  list: () => call<{ books: BookOpsBook[] }>("/books").then((r) => r.books),
  /** A new book: photos and/or an ISBN. `id` is made here, so sending it twice can't make two books. */
  add: (book: { id: string; front?: Blob; back?: Blob; isbn?: string | null; isbnSource?: "barcode" | "typed" }) => {
    const form = new FormData();
    form.set("id", book.id);
    if (book.front) form.set("front", book.front, "front.jpg");
    if (book.back) form.set("back", book.back, "back.jpg");
    if (book.isbn) {
      form.set("isbn", book.isbn);
      form.set("isbnSource", book.isbnSource ?? "barcode");
    }
    return call<One & { sameIsbn: number }>("/books", { method: "POST", body: form });
  },
  /** Photos for a book already in the queue: only the sides it doesn't have are kept. */
  attach: (id: string, photos: { front?: Blob; back?: Blob; isbn?: string | null }) => {
    const form = new FormData();
    if (photos.front) form.set("front", photos.front, "front.jpg");
    if (photos.back) form.set("back", photos.back, "back.jpg");
    if (photos.isbn) form.set("isbn", photos.isbn);
    return call<One>(`/books/${id}/photos`, { method: "POST", body: form }).then((r) => r.book);
  },
  edit: (id: string, patch: Record<string, unknown>) => call<One>(`/books/${id}`, json("PATCH", patch)).then((r) => r.book),
  remove: (id: string) => call<{ ok: boolean }>(`/books/${id}`, { method: "DELETE" }),
  /** Starts (or picks up) the lookup and the AI reading; answers when they're done. */
  process: (id: string, retry = false) => call<One>(`/books/${id}/process${retry ? "?retry=1" : ""}`, { method: "POST" }).then((r) => r.book),
  send: (id: string) => call<One>(`/books/${id}/send`, { method: "POST" }).then((r) => r.book),
  takeBack: (id: string) => call<One>(`/books/${id}/send`, { method: "DELETE" }).then((r) => r.book),
};
