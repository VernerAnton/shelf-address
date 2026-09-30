import { apiError, NO_STORE, readJson } from "@/lib/api";
import { applyReview } from "@/lib/reviews";

/** Saves a finished review (§16). Safe to repeat: the offline queue may send it twice. */
export async function POST(request: Request) {
  try {
    await applyReview(await readJson(request));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
