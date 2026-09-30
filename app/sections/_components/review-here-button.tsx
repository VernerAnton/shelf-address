"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { ReviewStartError, startReview } from "@/lib/client/review-store";
import { refreshPlaces, setActivePlace } from "@/lib/client/scan-store";

/**
 * Starts a review of this place (§16) and opens the Scan tab for it: scan
 * every book that's there, and the app works out what's new, what's missing
 * and what belongs elsewhere.
 */
export function ReviewHereButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await refreshPlaces();
            await setActivePlace(id);
            await startReview(id);
            router.push("/scan");
          } catch (e) {
            setError(e instanceof ReviewStartError ? e.message : "Couldn't start the review. Try again.");
            setBusy(false);
          }
        }}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface font-medium disabled:opacity-60"
      >
        <CheckIcon className="size-5" />
        {busy ? "Starting review…" : "Review books here"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
