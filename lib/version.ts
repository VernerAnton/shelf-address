/**
 * Bumped whenever work ships (see CLAUDE.md): a small fix or tweak adds .1
 * ("32" → "32.1" → "32.2"), a big change goes to the next whole number
 * ("32.2" → "33").
 *
 * Hand-maintained on purpose: a version should mark a change worth noticing,
 * not every commit — and keeping it in its own file makes the bump a one-line
 * diff that's obvious in review. A string, so "32.10" stays itself.
 */
export const APP_VERSION = "33";

/** Is version `a` newer than `b`? Compared as whole number, then the part after the dot ("32.10" is newer than "32.9"). */
export function isNewerVersion(a: string | number, b: string | number): boolean {
  const parts = (v: string | number) => String(v).split(".").map((x) => Number(x) || 0);
  const [a1, a2 = 0] = parts(a);
  const [b1, b2 = 0] = parts(b);
  return a1 !== b1 ? a1 > b1 : a2 > b2;
}

/** Commit and build time of this build, baked in by next.config.ts. */
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";

/**
 * Unique per build, and compiled identically into the page and the server.
 * "Is this page behind?" is answered by comparing the page's copy with the
 * server's (app/api/version). Because it includes the build time, every
 * deploy counts as new — even one that didn't bump APP_VERSION.
 */
export const BUILD_ID = `${BUILD_COMMIT}@${BUILD_TIME}`;
