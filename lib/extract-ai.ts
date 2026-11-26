import { Buffer } from "node:buffer";
import { getDb, getEnv } from "@/lib/cloudflare";
import { tidyAiText } from "@/lib/extract-text";
import { isAllowedModel, leastThinking } from "@/lib/ai-models";

/**
 * Extract's AI reading (docs/spec-corrections.md §23): a back-cover photo is
 * sent from the phone to this server, which asks a vision model on OpenRouter
 * to transcribe it. Only this needs the access code — the rest of the app is
 * open as before, and Extract can always fall back to reading on the phone.
 *
 * Settings (Worker secrets / variables):
 *   EXTRACT_CODE         the access code, chosen by the owner. Changing it logs
 *                        every phone out of the AI reading.
 *   OPENROUTER_API_KEY   the OpenRouter key. Spending is capped there (weekly
 *                        limit on the key), not here.
 *   EXTRACT_MODEL        optional: another OpenRouter model id.
 *   EXTRACT_THINKING     optional: how much the model may think before it
 *                        answers — none, minimal, low, medium, high. Unset
 *                        (the usual): the least each model accepts (V33.7,
 *                        lib/ai-models.ts). Copying text needs little thinking, and
 *                        thinking was most of the wait (§29).
 *   OPENROUTER_BASE      optional: tests point it at a local stand-in.
 */

export { DEFAULT_MODEL } from "@/lib/ai-models";
import { DEFAULT_MODEL } from "@/lib/ai-models";
const OPENROUTER = "https://openrouter.ai/api/v1";
export const COOKIE = "extract_login";
const TOKEN_PURPOSE = "shelf-address extract login v1";
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const AI_TIMEOUT_MS = 60_000;
/**
 * Room for the answer. Generous on purpose: the model can think before it
 * answers and that counts here too, and Finnish takes many tokens per word.
 * Until V26 it was 2,000, and long covers came back cut off (§27).
 */
const MAX_TOKENS = 20_000;

export class ExtractError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** What the phone should do: log in again, or read on the phone instead. */
    readonly kind: "login" | "fallback",
  ) {
    super(message);
  }
}

type Settings = { code: string | null; key: string | null; model: string; base: string; thinking: string };
const THINKING = ["none", "minimal", "low", "medium", "high"];

/** Exported for BookOps' own reading (lib/bookops-ai.ts), which asks the same model for more than the text. */
export async function settings(): Promise<Settings> {
  const env = (await getEnv()) as unknown as Record<string, string | undefined>;
  return {
    code: env.EXTRACT_CODE?.trim() || null,
    key: env.OPENROUTER_API_KEY?.trim() || null,
    model: env.EXTRACT_MODEL?.trim() || DEFAULT_MODEL,
    thinking: THINKING.includes(env.EXTRACT_THINKING?.trim() ?? "") ? env.EXTRACT_THINKING!.trim() : "",
    base: (env.OPENROUTER_BASE?.trim() || OPENROUTER).replace(/\/$/, ""),
  };
}

const b64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url");

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
}

/** Compares two strings without revealing, by timing, how much of them matched. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const salt = crypto.getRandomValues(new Uint8Array(16)).join(",");
  const [x, y] = await Promise.all([hmac(salt, a), hmac(salt, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
}

/**
 * The login cookie's value: derived from the code itself, so changing the code
 * invalidates every phone's login without anything stored server-side.
 */
async function tokenFor(code: string): Promise<string> {
  return hmac(code, TOKEN_PURPOSE);
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

/** The code as set now (for renewing a login that's already been checked). */
export async function currentCode(): Promise<string | null> {
  return (await settings()).code;
}

/** Is AI reading set up at all (code and key present)? */
export async function aiConfigured(): Promise<boolean> {
  const s = await settings();
  return Boolean(s.code && s.key);
}

export async function isLoggedIn(request: Request): Promise<boolean> {
  const { code } = await settings();
  const value = cookieValue(request);
  return Boolean(code && value && (await sameSecret(value, await tokenFor(code))));
}

/** The Set-Cookie header for a phone that gave the right code (or for logging out: `null`). */
export async function loginCookie(request: Request, code: string | null): Promise<string> {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const base = `${COOKIE}=${code ? await tokenFor(code) : ""}; Path=/api/extract; HttpOnly; SameSite=Strict${secure}`;
  // Browsers cap this at 400 days; each visit to Extract renews it (see the login route).
  return code ? `${base}; Max-Age=34560000` : `${base}; Max-Age=0`;
}

/** Checks a typed code. Throws (429) after too many wrong ones from this address. */
export async function checkCode(request: Request, typed: string): Promise<string | null> {
  const { code } = await settings();
  if (!code) throw new ExtractError("AI reading isn't set up yet.", 503, "fallback");
  const db = await getDb();
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
  await db.prepare("DELETE FROM extract_login_failures WHERE at < ?").bind(since).run();
  const { n } = (await db
    .prepare("SELECT COUNT(*) AS n FROM extract_login_failures WHERE ip = ? AND at >= ?")
    .bind(ip, since)
    .first<{ n: number }>()) ?? { n: 0 };
  if (n >= MAX_FAILURES) throw new ExtractError("Too many wrong codes. Try again in an hour.", 429, "login");
  if (await sameSecret(typed.trim(), code)) return code;
  await db.prepare("INSERT INTO extract_login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date().toISOString()).run();
  return null;
}

/** What the model is asked to do. Exact transcription, nothing added. */
export const INSTRUCTIONS = `This is a photo of the back cover of a book (usually Finnish, sometimes English or Swedish).
Transcribe the text printed on it exactly, word for word, as it would be retyped for a new back cover.

Rules:
- Copy the text exactly as printed: same words, spelling, punctuation and capitals. Do not correct, translate, summarise or add anything.
- Keep Finnish and Swedish letters exactly (ä, ö, å, Ä, Ö, Å).
- Join lines that the cover's width broke into whole paragraphs; undo hyphenation at line ends. Keep real paragraph breaks as a blank line.
- Keep the reading order of the cover: title or headline first if there is one, then the text, then quotes and their sources.
- Leave out: price stickers, barcodes and the numbers under them, ISBNs, publisher logos, and shop or library stickers.
- If part of the text can't be read, write [?] in its place rather than guessing.
- If there is no readable text, answer with nothing at all.
Answer with the transcribed text only — no introduction, no comments, no formatting marks.`;

/** How a reading went, for the phone's warning and for problem reports (§27). */
export type AiDetails = {
  model: string;
  /** Why the model stopped: "stop" (finished), "length" (ran out of room), or what OpenRouter said. */
  finishReason: string | null;
  promptTokens: number | null;
  answerTokens: number | null;
  /** Of the answer tokens, how many went on thinking. */
  thinkingTokens: number | null;
  maxTokens: number;
  ms: number;
  /** How much thinking was allowed (V32), and who at OpenRouter served it, if it says. */
  thinking?: string;
  /** The model as asked for (V33.5): OpenRouter names the same model for ":nitro" and standard. */
  requested?: string;
  /** The model's own stop reason, and the error it gave (V33.8), when it stopped with one. */
  nativeFinishReason?: string | null;
  error?: string | null;
  /** Read again with the default after this model stopped with an error (V33.8). */
  retriedFrom?: { model: string; error: string | null; nativeFinishReason: string | null; ms: number } | null;
  provider?: string | null;
};

type ChatBody = {
  model?: string;
  provider?: string;
  choices?: { finish_reason?: string | null; native_finish_reason?: string | null; message?: { content?: unknown }; error?: { message?: string; code?: unknown } }[];
  error?: { message?: string; code?: unknown; metadata?: unknown };
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
};

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Transcribes a back-cover photo (JPEG bytes) with the vision model. */
/**
 * Transcribes a back-cover photo. A chosen model that stops with an error
 * part-way (V33.8: Flash-Lite and 3.6 Flash both did, two thirds in) is
 * retried once with the default, so a cut-off text never arrives unannounced.
 */
export async function readWithAi(photo: ArrayBuffer, type: string, chosen?: string | null): Promise<{ text: string; details: AiDetails }> {
  const first = await readOnce(photo, type, chosen);
  const configured = (await settings()).model;
  if (first.details.finishReason !== "error" || first.details.requested === configured) return first;
  const second = await readOnce(photo, type, null);
  const d = first.details;
  return { ...second, details: { ...second.details, retriedFrom: { model: d.requested ?? d.model, error: d.error ?? null, nativeFinishReason: d.nativeFinishReason ?? null, ms: d.ms } } };
}

async function readOnce(photo: ArrayBuffer, type: string, chosen?: string | null): Promise<{ text: string; details: AiDetails }> {
  const configured = await settings();
  // A model the phone chose (V33.4), if it's one of ours; otherwise the default.
  const s = isAllowedModel(chosen) ? { ...configured, model: chosen } : configured;
  if (!s.key) throw new ExtractError("AI reading isn't set up yet.", 503, "fallback");
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new ExtractError("That isn't a photo.", 415, "fallback");
  if (photo.byteLength === 0 || photo.byteLength > PHOTO_MAX_BYTES) throw new ExtractError("That photo is too large.", 413, "fallback");

  // Node's Buffer (nodejs_compat): native base64, a few hundred KB in well under a millisecond of CPU.
  const dataUrl = `data:${type};base64,${Buffer.from(photo).toString("base64")}`;
  const started = Date.now();
  // effort: how much thinking to allow; null sends no thinking or routing settings at all.
  const ask = (effort: string | null) =>
    fetch(`${s.base}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.key}`,
        "content-type": "application/json",
        // Shown on OpenRouter's activity page, so the owner can tell what spent what.
        "x-title": "Shelf-Address Extract",
      },
      body: JSON.stringify({
        model: s.model,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        ...(effort && {
          // Thinking was 70–80% of what the model produced, and most of the wait (V32). Off since V33.6: a
          // reading with thinking was twice as slow and "improved" the wording ("Viestin sisältävän" for the
          // printed "Viestiin sisältyvän"); without it the copy was exact. We want a copy, not reasoning.
          reasoning: { effort },
          // Of the providers serving the model, the one answering fastest right now (V32).
          // (":nitro" does its own sorting — by speed, with the priority tier — so not with it.)
          ...(!s.model.endsWith(":nitro") && { provider: { sort: "latency" } }),
        }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: INSTRUCTIONS },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(1000, AI_TIMEOUT_MS - (Date.now() - started))),
    });
  // The least thinking this model accepts (V33.7), unless EXTRACT_THINKING says otherwise. If it's refused
  // all the same (400): "none" falls back to "minimal", and that to no settings, as before V32.
  const effort = s.thinking || leastThinking(s.model);
  const tries: (string | null)[] = [effort, ...(effort === "none" ? ["minimal"] : []), null];
  let response: Response;
  let used: string | null = null;
  try {
    for (;;) {
      used = tries.shift() ?? null;
      response = await ask(used);
      if (response.status !== 400 || !tries.length) break;
      console.error(`AI refused thinking "${used}":`, (await response.text().catch(() => "")).slice(0, 300));
    }
  } catch {
    throw new ExtractError("The AI didn't answer in time.", 504, "fallback");
  }
  if (response.status === 402 || response.status === 403) {
    throw new ExtractError("The AI's spending limit is used up for now.", 402, "fallback");
  }
  if (response.status === 401) throw new ExtractError("The AI key isn't working.", 502, "fallback");
  if (!response.ok) throw new ExtractError(`The AI couldn't read it (${response.status}).`, 502, "fallback");
  const body = (await response.json().catch(() => null)) as ChatBody | null;
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "";
  return {
    text: tidyAiText(text),
    details: {
      model: typeof body?.model === "string" ? body.model : s.model,
      requested: s.model,
      thinking: used ?? "model's default (settings refused)",
      provider: typeof body?.provider === "string" ? body.provider : null,
      finishReason: choice?.finish_reason ?? choice?.native_finish_reason ?? null,
      nativeFinishReason: choice?.native_finish_reason ?? null,
      error: (choice?.error?.message ?? body?.error?.message ?? null)?.slice(0, 500) ?? null,
      promptTokens: count(body?.usage?.prompt_tokens),
      answerTokens: count(body?.usage?.completion_tokens),
      thinkingTokens: count(body?.usage?.completion_tokens_details?.reasoning_tokens),
      maxTokens: MAX_TOKENS,
      ms: Date.now() - started,
    },
  };
}
