"use client";

/**
 * Reading a printed ISBN from a photo (docs/spec-corrections.md §19): for
 * books whose barcode is covered by a shop's sticker, a photo of the
 * copyright page. Tesseract runs on the phone, from files this site serves
 * (scripts/copy-vendor.mjs), so it works without signal once they're cached.
 */

import { findIsbns, type FoundIsbn } from "@/lib/isbn-text";
import { TESSERACT_DIR } from "./vendor-files";

type OcrWorker = import("tesseract.js").Worker;

const WORKER_URL = `${TESSERACT_DIR}/worker.min.js`;
const LANG_URL = `${TESSERACT_DIR}/lang/eng.traineddata.gz`;

/** The engine file Tesseract will pick on this phone (the same test it makes). */
async function coreUrl(): Promise<string> {
  const { simd, relaxedSimd } = await import("wasm-feature-detect");
  const variant = (await relaxedSimd()) ? "-relaxedsimd" : (await simd()) ? "-simd" : "";
  return `${TESSERACT_DIR}/tesseract-core${variant}-lstm.wasm.js`;
}

let warmed = false;
/**
 * Downloads the files in the background (about 7 MB, once) so the service
 * worker has them before the phone is out of signal. Doesn't start the engine.
 */
export function warmOcr() {
  if (warmed || !navigator.onLine) return;
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  warmed = true;
  void coreUrl()
    .then((core) => Promise.all([WORKER_URL, LANG_URL, core].map((url) => fetch(url).then((r) => r.blob()))))
    .catch(() => {
      warmed = false;
    });
}

let worker: Promise<OcrWorker> | null = null;
/** Starts the engine (once); later calls reuse it until it fails. */
function startOcr(): Promise<OcrWorker> {
  worker ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", 1, {
      workerPath: WORKER_URL,
      corePath: await coreUrl(),
      langPath: `${TESSERACT_DIR}/lang`,
      workerBlobURL: false,
      // The service worker already keeps the language file; don't store a second copy.
      cacheMethod: "none",
    });
  })().catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

/**
 * Throws the engine away, so the next photo starts a fresh one. Before V17 a
 * crashed engine (out of memory, say) stayed in use, and every photo after it
 * failed until the app was closed.
 */
async function resetOcr() {
  const old = worker;
  worker = null;
  await old?.then((w) => w.terminate()).catch(() => {});
}

/** Longest a single reading may take before the engine is taken to be stuck. */
const READ_TIMEOUT_MS = 60_000;

async function recognize(canvas: HTMLCanvasElement): Promise<string> {
  const ocr = await startOcr();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data } = await Promise.race([
      ocr.recognize(canvas),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Text reading took over ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
      }),
    ]);
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}

/** A photo at a size Tesseract reads well and quickly, turned by `turn` degrees. */
function prepare(bitmap: ImageBitmap, turn: 0 | 90 | 270): HTMLCanvasElement {
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = turn ? h : w;
  canvas.height = turn ? w : h;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas: the phone may be short of memory");
  context.filter = "grayscale(1) contrast(1.3)";
  if (turn) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.translate(-w / 2, -h / 2);
  }
  context.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

export type PhotoText = { found: FoundIsbn[]; text: string };

const TURN_NAMES = { 0: "upright", 90: "turned right", 270: "turned left" } as const;

/**
 * The ISBNs printed in a photo, each with the rest of its line as a label,
 * and all the text read (for the photo log). Tried upright first, then on
 * its sides. If the engine fails, it's restarted and the photo tried once
 * more; throws if it still fails (or can't start: files not downloaded yet
 * and no signal).
 */
export async function readIsbnsFromPhoto(bitmap: ImageBitmap): Promise<PhotoText> {
  const texts: string[] = [];
  for (const turn of [0, 90, 270] as const) {
    const canvas = prepare(bitmap, turn);
    let text: string;
    try {
      try {
        text = await recognize(canvas);
      } catch {
        await resetOcr();
        text = await recognize(canvas);
      }
    } catch (e) {
      await resetOcr();
      throw e;
    } finally {
      // Let the phone have the memory back now, not whenever it gets round to it.
      canvas.width = canvas.height = 0;
    }
    texts.push(`— ${TURN_NAMES[turn]} —\n${text.trim()}`);
    const found = findIsbns(text);
    if (found.length) return { found, text: texts.join("\n\n") };
  }
  return { found: [], text: texts.join("\n\n") };
}
