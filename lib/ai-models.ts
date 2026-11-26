/**
 * The AI models Extract may read with (V33.4). A phone can choose one under
 * Report a problem, to compare them on real covers; the server accepts only
 * these, so nothing else can be picked to spend on. The first is the default
 * (unless EXTRACT_MODEL is set in Cloudflare).
 */
export const AI_MODELS = [
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "x-ai/grok-4.20", label: "Grok 4.20" },
] as const;

export const isAllowedModel = (id: unknown): id is string => AI_MODELS.some((m) => m.id === id);

/** "Grok 4.20" for "x-ai/grok-4.20"; the id itself for one not on the list. */
export const modelLabel = (id: string | null | undefined) => AI_MODELS.find((m) => m.id === id || id?.startsWith(`${m.id}`))?.label ?? id ?? "AI";
