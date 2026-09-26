"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CoverCamera } from "@/components/cover-camera";
import { CameraIcon } from "@/components/icons";

/**
 * "Photograph cover" on a book's page (§15): for a book with no cover, or to
 * replace one that's wrong. The photo is shared by every copy of the edition.
 */
export function CoverPhoto({ editionKey, title, hasCover }: { editionKey: string; title: string; hasCover: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function save(photo: Blob) {
    let response: Response;
    try {
      response = await fetch(`/api/editions/cover?key=${encodeURIComponent(editionKey)}`, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: photo,
        redirect: "manual",
      });
    } catch {
      throw new Error("No connection. Try again when you have signal.");
    }
    if (response.type === "opaqueredirect") throw new Error("Your login has expired. Reload the page to log in again.");
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Couldn't save the photo. Try again.");
    }
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface font-medium"
      >
        <CameraIcon className="size-5" />
        {hasCover ? "Replace cover with a photo" : "Photograph cover"}
      </button>
      {open && <CoverCamera title={title} onSave={save} onClose={() => setOpen(false)} />}
    </>
  );
}
