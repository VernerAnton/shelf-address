import { NO_STORE } from "@/lib/api";
import { APP_VERSION, BUILD_ID } from "@/lib/version";

/**
 * Which build the server is running. An open page compares this with the
 * build it was loaded with to find out it's behind (components/app-update).
 * Under /api/, so the service worker never caches it.
 */
export async function GET() {
  return Response.json({ version: APP_VERSION, buildId: BUILD_ID }, { headers: NO_STORE });
}
