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
/** Starts the engine (once); later calls reuse it. */
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

/** A photo at a size Tesseract reads well and quickly, turned by `turn` degrees. */
function prepare(bitmap: ImageBitmap, turn: 0 | 90 | 270): HTMLCanvasElement {
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = turn ? h : w;
  canvas.height = turn ? w : h;
  const context = canvas.getContext("2d")!;
  context.filter = "grayscale(1) contrast(1.3)";
  if (turn) {
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.translate(-w / 2, -h / 2);
  }
  context.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

/**
 * The ISBNs printed in a photo, each with the rest of its line as a label.
 * Tried upright first, then on its sides. Throws if the reader can't start
 * (files not downloaded yet and no signal).
 */
export async function readIsbnsFromPhoto(file: Blob): Promise<FoundIsbn[]> {
  const ocr = await startOcr();
  const bitmap = await createImageBitmap(file);
  try {
    for (const turn of [0, 90, 270] as const) {
      const { data } = await ocr.recognize(prepare(bitmap, turn));
      const found = findIsbns(data.text);
      if (found.length) return found;
    }
    return [];
  } finally {
    bitmap.close();
  }
}
