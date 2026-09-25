"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScanIcon } from "@/components/icons";
import { refreshPlaces, setActivePlace } from "@/lib/client/scan-store";

/** Makes this place the one scans are logged at, and opens the Scan tab. */
export function ScanHereButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // Make sure the phone's copy of the tree knows this place (it may be new).
        await refreshPlaces();
        await setActivePlace(id);
        router.push("/scan");
      }}
      className="flex h-12 items-center justify-center gap-2 rounded-xl border border-accent font-medium text-accent disabled:opacity-60"
    >
      <ScanIcon className="size-5" />
      Scan books here
    </button>
  );
}
