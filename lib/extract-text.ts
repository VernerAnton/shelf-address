/**
 * Tidying text read from a photo of a book's back cover, for Extract
 * (docs/spec-corrections.md §22), so it can be pasted straight into a new
 * back cover:
 *
 * - lines broken by the page width are joined back into paragraphs; a blank
 *   line (as Tesseract reports paragraph gaps) stays a paragraph break;
 * - a word hyphenated across lines ("kirjoit-" / "taja") is joined
 *   ("kirjoittaja"), unless the hyphen is real: after a capital or a digit
 *   ("EU-" / "maissa" gives "EU-maissa") or before a capital
 *   ("Etelä-Suomessa");
 * - specks read as letters (a lone "|", ".", "~") are dropped, and runs of
 *   spaces collapsed.
 */

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** A line that is just specks: no letters or digits, or a single stray character. */
function isNoise(line: string): boolean {
  const t = line.trim();
  return !LETTER_OR_DIGIT.test(t) || (t.length === 1 && !/[\p{N}AaIiOo]/u.test(t));
}

export function tidyText(raw: string): string {
  const paragraphs = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !isNoise(l));
      let out = "";
      for (const line of lines) {
        if (!out) {
          out = line;
          continue;
        }
        const hyphen = /([\p{L}\p{N}])([-­])$/u.exec(out);
        if (!hyphen) out = `${out} ${line}`;
        else if (hyphen[2] === "­" || (/^\p{Ll}/u.test(line) && !/[\p{Lu}\p{N}]/u.test(hyphen[1]))) {
          out = out.slice(0, -1) + line; // a word split by the line end
        } else out += line; // a real hyphen: "EU-maissa", "Etelä-Suomessa"
      }
      return out.replace(/ {2,}/g, " ").trim();
    })
    .filter(Boolean);
  return paragraphs.join("\n\n");
}

/** "takakansi-2026-10-26-1432.txt" style name for a shared text file, from the first words. */
export function textFileName(text: string, at: Date): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const start = (words ?? []).slice(0, 4).join("-").slice(0, 40) || "teksti";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${start}-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.txt`;
}

/**
 * How much a read looks like real words, 0–1: the share of its letters that
 * are in word-like tokens (two or more letters with a vowel, optionally
 * followed by punctuation). Text read the wrong way up comes out as symbols
 * and stray letters, and Tesseract can still be confident about it, so this is
 * how Extract tells which way a photo was taken.
 */
export function wordLikeness(text: string): number {
  const tokens = text.split(/\s+/).filter(Boolean);
  let all = 0;
  let wordy = 0;
  for (const t of tokens) {
    all += t.length;
    if (/^["'(«»„”]?[\p{L}][\p{L}'’-]+[.,;:!?)"'»”]*$/u.test(t) && /[aeiouyäöåAEIOUYÄÖÅ]/.test(t)) wordy += t.length;
  }
  return all ? wordy / all : 0;
}
