/**
 * Phone or computer, from the browser's User-Agent (docs/spec-corrections.md
 * §25). Only used to pick where the app opens: phones scan and photograph,
 * the computer is where Saved texts are picked up. An iPad, which reports
 * itself as a Mac, counts as a computer — fine for this.
 */
export function isPhone(userAgent: string | null): boolean {
  return /Mobi|Android|iPhone|iPod/i.test(userAgent ?? "");
}
