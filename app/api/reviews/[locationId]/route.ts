import { apiError, NO_STORE } from "@/lib/api";
import { reviewSnapshot } from "@/lib/reviews";

/** What a review of this place starts from: the copies logged there, and the missing list (§16). */
export async function GET(_request: Request, ctx: RouteContext<"/api/reviews/[locationId]">) {
  try {
    const { locationId } = await ctx.params;
    return Response.json(await reviewSnapshot(locationId), { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
