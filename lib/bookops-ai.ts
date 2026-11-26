import { FALLBACK_MODEL } from "@/lib/ai-models";
import { Buffer } from "node:buffer";
import { settings } from "@/lib/extract-ai";
import { tidyAiText } from "@/lib/extract-text";
import { findIsbns } from "@/lib/isbn-text";

/**
 * BookOps' AI reading (docs/spec-corrections.md §30): the photos of a book's
 * front and back cover go to the same vision model Extract uses (OpenRouter,
 * same key, same spending cap), which is asked for four things at once — the
 * back-cover text, the printed ISBN, the title and the author.
 *
 * The AI is the fallback for everything but the text: the ISBN normally
 * comes from the barcode and the title and author from a book database. An
 * ISBN it reads is only used if its check digit is right, so a misread number
 * is dropped rather than turning into the wrong book.
 */

const AI_TIMEOUT_MS = 60_000;

export type AiReading = { isbn13: string | null; title: string | null; author: string | null; description: string | null };

export class BookOpsAiError extends Error {}

export const BOOKOPS_INSTRUCTIONS = `These are photos of one book: its front cover and its back cover (usually Finnish, sometimes English or Swedish).
Answer with one JSON object and nothing else, with exactly these keys:

"title": the book's title as printed on the front cover, or null if it can't be read.
"author": the author's name (or names, separated by commas) as printed on the cover, or null if none can be read.
"isbn": the ISBN printed on the back cover — the digits near the barcode or in the small print — exactly as printed, or null if no ISBN can be read. Never make one up or fill in digits you can't see.
"description": the text printed on the back cover, transcribed exactly, word for word, as it would be retyped for a new back cover; or null if there is no readable text.

Rules for "description":
- Copy the text exactly as printed: same words, spelling, punctuation and capitals. Do not correct, translate, summarise or add anything.
- Keep Finnish and Swedish letters exactly (ä, ö, å, Ä, Ö, Å).
- Join lines that the cover's width broke into whole paragraphs; undo hyphenation at line ends. Keep real paragraph breaks as a blank line (\\n\\n).
- Keep the reading order of the cover: headline first if there is one, then the text, then quotes and their sources.
- Leave out: price stickers, barcodes and the numbers under them, ISBNs, publisher logos, and shop or library stickers.
- If part of the text can't be read, write [?] in its place rather than guessing.`;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t && !/^(null|none|n\/a|unknown|-)$/i.test(t) ? t.slice(0, max) : null;
};

/**
 * The model's answer → what BookOps uses. Tolerates a code fence or a few
 * words around the JSON; anything that isn't a JSON object throws.
 */
export function parseAiReading(raw: string): AiReading {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let parsed: unknown = null;
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BookOpsAiError("The AI's answer couldn't be understood.");
  const answer = parsed as Record<string, unknown>;
  const description = typeof answer.description === "string" ? tidyAiText(answer.description) : "";
  const isbn = typeof answer.isbn === "string" || typeof answer.isbn === "number" ? String(answer.isbn) : "";
  return {
    // Only an ISBN whose check digit is right.
    isbn13: findIsbns(isbn)[0]?.isbn13 ?? null,
    title: text(answer.title, 300),
    author: text(answer.author, 300),
    description: description || null,
  };
}

export type Photo = { bytes: ArrayBuffer; type: string; side: "front" | "back" };

/** Reads the photos with the vision model. Throws BookOpsAiError with a message for the screen. */
export async function readBook(photos: Photo[]): Promise<AiReading> {
  const s = await settings();
  if (!s.key) throw new BookOpsAiError("AI reading isn't set up yet.");
  if (photos.length === 0) throw new BookOpsAiError("There are no photos to read.");
  const content: unknown[] = [{ type: "text", text: BOOKOPS_INSTRUCTIONS }];
  for (const photo of photos) {
    content.push({ type: "text", text: photo.side === "front" ? "Front cover:" : "Back cover:" });
    content.push({ type: "image_url", image_url: { url: `data:${photo.type};base64,${Buffer.from(photo.bytes).toString("base64")}` } });
  }
  let response: Response;
  try {
    response = await fetch(`${s.base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.key}`,
        "content-type": "application/json",
        // Shown on OpenRouter's activity page, so the owner can tell what spent what.
        "x-title": "Shelf-Address BookOps",
      },
      // BookOps stays on 3.8 Flash · Nitro (V33.9): Extract's default became Flash-Lite, untried for BookOps.
      body: JSON.stringify({ model: FALLBACK_MODEL, temperature: 0, max_tokens: 2500, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch {
    throw new BookOpsAiError("The AI didn't answer in time.");
  }
  if (response.status === 402 || response.status === 403) throw new BookOpsAiError("The AI's spending limit is used up for now.");
  if (response.status === 401) throw new BookOpsAiError("The AI key isn't working.");
  if (!response.ok) throw new BookOpsAiError(`The AI couldn't read it (${response.status}).`);
  const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const answer = body?.choices?.[0]?.message?.content;
  const raw = typeof answer === "string" ? answer : Array.isArray(answer) ? answer.map((c) => (c as { text?: string }).text ?? "").join("") : "";
  return parseAiReading(raw);
}
