/**
 * Address rules. Spec §4 as amended by docs/spec-corrections.md §1–2: one
 * address, one shelf, across every site. No site prefix is typed; the site is
 * shown by walking the tree.
 *
 * Pure functions only — no database access — so they can be unit tested.
 */

/**
 * Tidies what was typed into what gets stored and shown: Unicode-normalised
 * (so a precomposed "Ä" and "A" + combining diaeresis are the same text),
 * trimmed, with internal runs of whitespace collapsed to one space.
 */
export function cleanAddress(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * The form uniqueness is enforced on (`locations.address_key`). Case-folded
 * with full Unicode rules, which SQLite's NOCASE does not do: "Ä" and "ä"
 * collide here but not there.
 */
export function addressKey(raw: string): string {
  return cleanAddress(raw).toLocaleLowerCase("fi-FI");
}

/** Letters and digits only, split into words. Punctuation is ignored. */
function words(key: string): string[] {
  return key.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True if `needle` appears in `haystack` as a run of consecutive words. */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Whether two addresses look like the same place written two ways, without
 * being identical — e.g. "Warehouse A Bulevard 1" vs "Bulevard 1", or
 * "Bulevard-1" vs "Bulevard 1".
 *
 * Compared word by word, never as raw substrings, so "Bulevard 1" and
 * "Bulevard 10" are *not* similar: "1" and "10" are different words.
 *
 * Exact duplicates return false here — those are handled separately as a hard
 * conflict, not a soft warning.
 */
export function isSimilarAddress(aKey: string, bKey: string): boolean {
  if (aKey === bKey) return false;
  const a = words(aKey);
  const b = words(bKey);
  return a.length >= b.length ? containsRun(a, b) : containsRun(b, a);
}

/**
 * How an address is shown back: with the site it's under, taken from the
 * tree rather than typed (docs/spec-corrections.md §1). A standalone shelf
 * with no site above it shows the bare address.
 */
export function displayAddress(address: string, siteLabel: string | null): string {
  return siteLabel ? `${siteLabel} — ${address}` : address;
}
