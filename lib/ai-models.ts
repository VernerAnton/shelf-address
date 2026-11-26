/**
 * The AI models Extract may read with. A phone can choose one under Report a
 * problem, to compare them on real covers (V33.4); the server accepts only
 * these, so nothing else can be picked to spend on. The first is the default
 * (unless EXTRACT_MODEL is set in Cloudflare).
 *
 * V33.5: Grok 4.20 was tried in the shop and was about half as fast as
 * Gemini, so it's gone. ":nitro" asks OpenRouter for the fastest endpoints,
 * Google's priority tier included (dearer: about $1.35/$6.75 per million
 * tokens against $0.75/$3.75 — still well under a cent a cover); the
 * standard one stays on the list to compare.
 */
export const AI_MODELS = [
  { id: "google/gemini-3.8-flash:nitro", label: "Gemini 3.8 Flash · Nitro" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash · standard" },
] as const;

export const DEFAULT_MODEL: string = AI_MODELS[0].id;

export const isAllowedModel = (id: unknown): id is string => AI_MODELS.some((m) => m.id === id);

/** "Gemini 3.8 Flash · Nitro" for "google/gemini-3.8-flash:nitro"; the id itself for one not on the list. */
export const modelLabel = (id: string | null | undefined) => AI_MODELS.find((m) => m.id === id)?.label ?? id ?? "AI";
