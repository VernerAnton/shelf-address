/**
 * The AI models Extract may read with. A phone can choose one under Report a
 * problem, to compare them on real covers (V33.4); the server accepts only
 * these, so nothing else can be picked to spend on. The first is the default
 * (unless EXTRACT_MODEL is set in Cloudflare).
 *
 * V33.5: Grok 4.20 was tried in the shop and was about half as fast as
 * Gemini, so it's gone. ":nitro" asks OpenRouter for the fastest endpoints,
 * Google's priority tier included (dearer, still well under a cent a cover).
 *
 * V33.7: `thinking` is the least thinking each model accepts, as OpenRouter's
 * model list gives it (GET /api/v1/models, `reasoning.supported_efforts`).
 * Gemini 3.8 Flash can't be stopped from thinking — "none" is refused and
 * "minimal" isn't on its list — so it's asked for "low". Two more to compare:
 * 3.1 Flash-Lite, where thinking can be off (and a third of the price), and
 * 3.6 Flash, which takes "minimal".
 *
 * V33.9, the owner's choice after comparing in the shop: Flash-Lite is the
 * default — about 4–6 s, as accurate as 3.8 Flash on the books compared, a
 * third of the price. On a book it stops part-way on (one did, every time),
 * the server reads it again with 3.8 Flash · Nitro (FALLBACK_MODEL), which
 * read that book in full.
 */
export const AI_MODELS = [
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite · no thinking", thinking: "none" },
  { id: "google/gemini-3.8-flash:nitro", label: "Gemini 3.8 Flash · Nitro", thinking: "low" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash · standard", thinking: "low" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash · minimal thinking", thinking: "minimal" },
] as const;

/** Reads again when a model stops part-way with an error (V33.8); also BookOps' model (V33.9). */
export const FALLBACK_MODEL = "google/gemini-3.8-flash:nitro";

export const DEFAULT_MODEL: string = AI_MODELS[0].id;

export const isAllowedModel = (id: unknown): id is string => AI_MODELS.some((m) => m.id === id);

/** The least thinking a model accepts ("low" for one not on the list: every thinking model takes it). */
export const leastThinking = (id: string): string => AI_MODELS.find((m) => m.id === id)?.thinking ?? "low";

/** "Gemini 3.8 Flash · Nitro" for "google/gemini-3.8-flash:nitro"; the id itself for one not on the list. */
export const modelLabel = (id: string | null | undefined) => AI_MODELS.find((m) => m.id === id)?.label ?? id ?? "AI";
