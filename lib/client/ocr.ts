"use client";

/**
 * Reading text from photos with Tesseract, on the phone, from files this site
 * serves (scripts/copy-vendor.mjs), so it works without signal once cached:
 * - a printed ISBN, for books whose barcode is covered (§19): English data;
 * - a book's back-cover text, for Extract (§22): Finnish and English.
 * One engine at a time: a weak phone can't spare the memory for two.
 */

import { wordLikeness } from "@/lib/extract-text";
import { findIsbns, type FoundIsbn } from "@/lib/isbn-text";
import { TESSERACT_DIR } from "./vendor-files";

type OcrWorker = import("tesseract.js").Worker;

const WORKER_URL = `${TESSERACT_DIR}/worker.min.js`;
const langUrl = (lang: string) => `${TESSERACT_DIR}/lang/${lang}.traineddata.gz`;

/** "eng" for ISBNs; "fin+eng" for Extract (Finnish texts quote English titles and names). */
export type Langs = "eng" | "fin+eng";

/** The engine file Tesseract will pick on this phone (the same test it makes). */
async function coreUrl(): Promise<string> {
  const { simd, relaxedSimd } = await import("wasm-feature-detect");
  const variant = (await relaxedSimd()) ? "-relaxedsimd" : (await simd()) ? "-simd" : "";
  return `${TESSERACT_DIR}/tesseract-core${variant}-lstm.wasm.js`;
}

const warmed = new Set<Langs>();
/**
 * Downloads the files in the background (about 7 MB, once) so the service
 * worker has them before the phone is out of signal. Doesn't start the engine.
 */
export function warmOcr(langs: Langs = "eng") {
  if (warmed.has(langs) || !navigator.onLine) return;
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  warmed.add(langs);
  void coreUrl()
    .then((core) => Promise.all([WORKER_URL, core, ...langs.split("+").map(langUrl)].map((url) => fetch(url).then((r) => r.blob()))))
    .catch(() => {
      warmed.delete(langs);
    });
}

let worker: { langs: Langs; ready: Promise<OcrWorker> } | null = null;
/** Starts the engine for these languages (once); later calls reuse it until it fails or other languages are wanted. */
async function startOcr(langs: Langs): Promise<OcrWorker> {
  if (worker && worker.langs !== langs) await resetOcr();
  if (worker) return worker.ready;
  const ready = (async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker(langs, 1, {
      workerPath: WORKER_URL,
      corePath: await coreUrl(),
      langPath: `${TESSERACT_DIR}/lang`,
      workerBlobURL: false,
      // The service worker already keeps the language file; don't store a second copy.
      cacheMethod: "none",
    });
  })().catch((e) => {
    if (worker?.ready === ready) worker = null;
    throw e;
  });
  worker = { langs, ready };
  return ready;
}

/**
 * Throws the engine away, so the next photo starts a fresh one. Before V17 a
 * crashed engine (out of memory, say) stayed in use, and every photo after it
 * failed until the app was closed.
 */
async function resetOcr() {
  const old = worker;
  worker = null;
  await old?.ready.then((w) => w.terminate()).catch(() => {});
}

/** Longest a single reading may take before the engine is taken to be stuck. */
const READ_TIMEOUT_MS = 60_000;

async function recognize(canvas: HTMLCanvasElement, langs: Langs): Promise<{ text: string; confidence: number }> {
  const ocr = await startOcr(langs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data } = await Promise.race([
      ocr.recognize(canvas),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Text reading took over ${READ_TIMEOUT_MS / 1000} s`)), READ_TIMEOUT_MS);
      }),
    ]);
    return { text: data.text, confidence: data.confidence };
  } finally {
    clearTimeout(timer);
  }
}

/** A photo at a size Tesseract reads well and quickly (`side` pixels at most), turned by `turn` degrees. */
function prepare(bitmap: ImageBitmap, turn: 0 | 90 | 270, side = 2000): HTMLCanvasElement {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
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
/** Reads one orientation; a failed engine is restarted and the read tried once more. */
async function readTurn(bitmap: ImageBitmap, turn: 0 | 90 | 270, langs: Langs, side?: number) {
  const canvas = prepare(bitmap, turn, side);
  try {
    try {
      return await recognize(canvas, langs);
    } catch {
      await resetOcr();
      return await recognize(canvas, langs);
    }
  } catch (e) {
    await resetOcr();
    throw e;
  } finally {
    // Let the phone have the memory back now, not whenever it gets round to it.
    canvas.width = canvas.height = 0;
  }
}

export async function readIsbnsFromPhoto(bitmap: ImageBitmap): Promise<PhotoText> {
  const texts: string[] = [];
  for (const turn of [0, 90, 270] as const) {
    const { text } = await readTurn(bitmap, turn, "eng");
    texts.push(`— ${TURN_NAMES[turn]} —\n${text.trim()}`);
    const found = findIsbns(text);
    if (found.length) return { found, text: texts.join("\n\n") };
  }
  return { found: [], text: texts.join("\n\n") };
}

/** A read this word-like (lib/extract-text.ts) and confident is taken as the right way up. */
const GOOD_WORDS = 0.6;
const CONFIDENT = 60;

/**
 * The text in a photo, for Extract (§22), with Tesseract's confidence
 * (0–100). Read upright; if that doesn't look like real words, on its sides
 * too, keeping the most word-like. Photos are read at up to 2400 px: body
 * text on a back cover is small.
 */
export async function readTextFromPhoto(bitmap: ImageBitmap): Promise<{ text: string; confidence: number }> {
  const score = (r: { text: string; confidence: number }) => wordLikeness(r.text) * Math.max(r.confidence, 1);
  let best = await readTurn(bitmap, 0, "fin+eng", 2400);
  if (wordLikeness(best.text) >= GOOD_WORDS && best.confidence >= CONFIDENT) return best;
  for (const turn of [90, 270] as const) {
    const read = await readTurn(bitmap, turn, "fin+eng", 2400);
    if (score(read) > score(best)) best = read;
    if (wordLikeness(best.text) >= GOOD_WORDS && best.confidence >= CONFIDENT) break;
  }
  return best;
}
