import { listPhotoLog, type PhotoLogEntry, type PhotoOutcome } from "@/lib/photo-log";
import { DeleteEntryButton, PhotoLogControls } from "./_components/photo-log-controls";

export const dynamic = "force-dynamic";

const LABELS: Record<PhotoOutcome, string> = {
  barcode: "Barcode read",
  isbn: "ISBN read",
  several: "Several ISBNs, asked which",
  none: "Nothing found",
  error: "Error",
  lost: "Photo lost",
};

const GOOD: PhotoOutcome[] = ["barcode", "isbn", "several"];

function when(iso: string) {
  return new Date(iso).toLocaleString("fi-FI", { timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "Android 15 · Chrome 141", "iPhone · Safari 18": enough to tell phones apart. */
function phone(ua: string | null) {
  if (!ua) return "unknown phone";
  const os = /Android ([\d.]+)/.exec(ua)?.[0] ?? (/iPhone|iPad/.test(ua) ? "iPhone" : /Windows|Macintosh|Linux/.exec(ua)?.[0] ?? "other");
  const browser = /SamsungBrowser\/(\d+)/.exec(ua)
    ? `Samsung Internet ${/SamsungBrowser\/(\d+)/.exec(ua)![1]}`
    : /CriOS\/(\d+)|Chrome\/(\d+)/.exec(ua)
      ? `Chrome ${(/CriOS\/(\d+)|Chrome\/(\d+)/.exec(ua)!.slice(1).find(Boolean))}`
      : /Version\/(\d+).*Safari/.exec(ua)
        ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}`
        : "browser";
  return `${os} · ${browser}`;
}

function Entry({ e }: { e: PhotoLogEntry }) {
  const good = GOOD.includes(e.outcome);
  const details = [
    e.width && e.height ? `${e.width}×${e.height}` : null,
    e.bytes ? `${(e.bytes / 1024 / 1024).toFixed(1)} MB` : null,
    e.durationMs != null ? `${(e.durationMs / 1000).toFixed(1)} s` : null,
    e.screen.replace(/^\//, "") || null,
    e.appVersion ? `V${e.appVersion}` : null,
  ].filter(Boolean);
  return (
    <li className="flex gap-3 border-b border-line p-3 last:border-0">
      {e.hasThumb ? (
        <a href={`/api/photo-log/${e.id}/photo`} target="_blank" rel="noopener" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API, sizes vary */}
          <img src={`/api/photo-log/${e.id}/thumb`} alt="Photo" loading="lazy" className="size-20 rounded-md bg-line object-cover" />
        </a>
      ) : (
        <div className="flex size-20 shrink-0 items-center justify-center rounded-md bg-line text-center text-xs text-muted">no photo</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex items-start justify-between gap-2">
          <span className={`font-semibold ${good ? "text-accent" : e.outcome === "none" ? "text-warn-text" : "text-danger"}`}>
            {LABELS[e.outcome]}
          </span>
          <span className="shrink-0 text-xs text-muted">{when(e.takenAt)}</span>
        </div>
        {e.isbns.length > 0 && <span className="font-mono text-xs">{e.isbns.join(", ")}</span>}
        {e.error && <span className="break-words text-xs text-danger">{e.error}</span>}
        <span className="text-xs text-muted">{[phone(e.userAgent), ...details].join(" · ")}</span>
        {e.ocrText && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Text the reader saw</summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-line/50 p-2 font-mono">{e.ocrText}</pre>
          </details>
        )}
        <div className="flex gap-3 text-xs">
          {e.hasPhoto && (
            <a href={`/api/photo-log/${e.id}/photo`} target="_blank" rel="noopener" className="font-medium text-accent">
              Full photo
            </a>
          )}
          <DeleteEntryButton id={e.id} />
        </div>
      </div>
    </li>
  );
}

/**
 * Photo log (docs/spec-corrections.md §21): every photo taken with "Camera
 * struggling? Take a photo", with what the app made of it. For finding out
 * why reading printed ISBNs fails; entries go after 30 days.
 */
export default async function PhotoLogPage() {
  const entries = await listPhotoLog(200);
  const counts = entries.reduce<Partial<Record<PhotoOutcome, number>>>((c, e) => ({ ...c, [e.outcome]: (c[e.outcome] ?? 0) + 1 }), {});
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Photo log</h1>
      <p className="text-sm text-muted">
        Every photo taken with &ldquo;Camera struggling? Take a photo&rdquo;, with what the app made of it — to find out why
        reading ISBNs fails. Kept for 30 days.
      </p>
      <PhotoLogControls />
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No photos yet.</p>
      ) : (
        <>
          <p aria-label="Summary" className="text-sm">
            {entries.length} photo{entries.length === 1 ? "" : "s"}:{" "}
            {(Object.keys(LABELS) as PhotoOutcome[])
              .filter((o) => counts[o])
              .map((o) => `${counts[o]} ${LABELS[o].toLowerCase()}`)
              .join(", ")}
          </p>
          <ul aria-label="Photos" className="overflow-hidden rounded-xl border border-line bg-surface">
            {entries.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
