"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { flushPhotoLog, pendingPhotoLogCount, photoLogOn, setPhotoLogOn } from "@/lib/client/photo-log";

/** The per-phone switch, and what's still waiting to upload from this phone. */
export function PhotoLogControls() {
  const router = useRouter();
  const [on, setOn] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setOn(photoLogOn());
      const before = await pendingPhotoLogCount();
      if (!alive) return;
      setPending(before);
      if (!before) return;
      // Anything waiting goes up now; the list then shows it.
      await flushPhotoLog();
      const after = await pendingPhotoLogCount();
      if (!alive) return;
      setPending(after);
      if (after < before) router.refresh();
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <section aria-label="Photo log settings" className="overflow-hidden rounded-xl border border-line bg-surface text-sm">
      <label className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <span>Keep photos from this phone</span>
        <input
          type="checkbox"
          role="switch"
          checked={on ?? true}
          disabled={on === null}
          onChange={(e) => {
            setPhotoLogOn(e.target.checked);
            setOn(e.target.checked);
          }}
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
      </label>
      <p className="px-4 py-3 text-xs text-muted">
        {pending > 0
          ? `${pending} photo${pending === 1 ? "" : "s"} from this phone waiting for signal to upload.`
          : "Everything from this phone is uploaded."}
      </p>
    </section>
  );
}

export function DeleteEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/photo-log/${id}`, { method: "DELETE", headers: { "X-Photo-Log": "1" } }).catch(() => {});
        router.refresh();
      }}
      className="font-medium text-danger disabled:opacity-40"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
