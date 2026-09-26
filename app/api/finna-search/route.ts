import { NO_STORE } from "@/lib/api";
import { getEnv } from "@/lib/cloudflare";
import { DEFAULT_CONFIG } from "@/lib/lookup/chain";
import { finnaTitleSearchUrl, parseFinnaEditionSearch } from "@/lib/lookup/finna";

/**
 * Title/author search for logging a book without a barcode:
 * GET /api/finna-search?title=Sinuhe&author=Waltari
 * Returns distinct printed editions to pick from.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = (params.get("title") ?? "").trim().slice(0, 200);
  const author = (params.get("author") ?? "").trim().slice(0, 200);
  if (!title && !author) {
    return Response.json({ error: "Type a title or an author.", permanent: true }, { status: 400 });
  }
  const env = (await getEnv()) as unknown as Record<string, string | undefined>;
  const base = env.FINNA_API_BASE ?? DEFAULT_CONFIG.finnaBase;
  const coverBase = env.FINNA_COVER_BASE ?? env.FINNA_API_BASE ?? DEFAULT_CONFIG.finnaCoverBase;
  try {
    const response = await fetch(finnaTitleSearchUrl(base, title, author), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Finna ${response.status}`);
    const choices = parseFinnaEditionSearch(await response.json(), coverBase);
    return Response.json({ choices }, { headers: NO_STORE });
  } catch {
    return Response.json(
      { error: "Finna didn't answer. Try again, or enter the book by hand.", permanent: false },
      { status: 502 },
    );
  }
}
