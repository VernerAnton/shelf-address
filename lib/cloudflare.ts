import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Access to the Worker's bindings (spec §8: native bindings, not the D1 HTTP API).
 *
 * Always call these from server code — a Server Component, a Route Handler or a
 * Server Action. They have no meaning in the browser.
 *
 * The `async: true` form is required anywhere that can run during `next build`
 * as well as at request time.
 */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

/** D1: locations, editions, copies. */
export async function getDb(): Promise<D1Database> {
  return (await getEnv()).DB;
}

/** R2: cover images (§2.2) and site reference maps (§5). */
export async function getBucket(): Promise<R2Bucket> {
  return (await getEnv()).BUCKET;
}
