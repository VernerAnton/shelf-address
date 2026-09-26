/**
 * Bump by one whenever work ships (see CLAUDE.md).
 *
 * Hand-maintained on purpose: a version should mark a change worth noticing,
 * not every commit — and keeping it in its own file makes the bump a one-line
 * diff that's obvious in review.
 */
export const APP_VERSION = 2;

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
