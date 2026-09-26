/**
 * Library catalogues write names "Waltari, Mika" or "Waltari, Mika, 1908-1979";
 * everything shown in the app uses "Mika Waltari".
 */
export function displayName(raw: string): string {
  const cleaned = raw
    .replace(/,?\s*\d{3,4}\s*-\s*(\d{3,4})?\.?\s*$/, "") // life dates
    .trim()
    .replace(/[.,;:]+$/, "")
    .trim();
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2 && !/\d/.test(parts[1])) return `${parts[1]} ${parts[0]}`;
  return cleaned;
}

/** Up to three distinct names, "A, B, C". Null when there are none. */
export function joinNames(names: (string | null | undefined)[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const name = displayName(raw);
    const key = name.toLocaleLowerCase("fi-FI");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === 3) break;
  }
  return out.length ? out.join(", ") : null;
}

/** A year from "1997", "October 1, 1988", "[1946]", "c2003". */
export function parseYear(value: unknown): number | null {
  const match = typeof value === "string" ? value.match(/(1[5-9]\d\d|20\d\d)/) : null;
  return match ? Number(match[1]) : null;
}

/** Trims the catalogue punctuation titles often carry: `"Title" /`, `Title :`. */
export function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\s*[/:;=,.]+\s*$/, "")
    .trim();
}
