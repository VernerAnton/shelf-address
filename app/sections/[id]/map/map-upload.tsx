"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/** Longest side of the stored photo: plenty to read a sketch, a few hundred KB. */
const MAX_SIDE = 2000;

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Older Safari: fall back to an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Shrinks a phone photo to at most MAX_SIDE px and re-encodes it as JPEG. */
async function downscale(file: File): Promise<Blob> {
  const image = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.fillStyle = "#fff"; // transparent PNGs become white, not black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("encode failed");
  return blob;
}

/** Take or choose a photo of the site's map; replace or remove it (§5). */
export function MapUpload({ siteId, hasMap }: { siteId: string; hasMap: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function send(init: RequestInit, kind: "upload" | "remove") {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/map`, { ...init, redirect: "manual" });
      if (response.type === "opaqueredirect") {
        setError("Your login has expired. Reload the page to log in again.");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Couldn't save. Try again.");
        return;
      }
      setConfirmRemove(false);
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    let body: Blob;
    try {
      body = await downscale(file);
    } catch {
      setError("Couldn't read that photo. Try a JPEG or PNG.");
      return;
    } finally {
      if (input.current) input.current.value = "";
    }
    await send({ method: "PUT", headers: { "Content-Type": "image/jpeg" }, body }, "upload");
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="Map photo"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => input.current?.click()}
        className={`h-12 rounded-xl font-medium disabled:opacity-60 ${hasMap ? "border border-line bg-surface" : "bg-accent text-accent-contrast"}`}
      >
        {busy === "upload" ? "Uploading…" : hasMap ? "Replace photo" : "Add a photo of the map"}
      </button>
      {hasMap &&
        (confirmRemove ? (
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirmRemove(false)} className="h-12 flex-1 rounded-xl border border-line bg-surface font-medium">
              Keep it
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => send({ method: "DELETE" }, "remove")}
              className="h-12 flex-1 rounded-xl bg-danger font-medium text-white disabled:opacity-60"
            >
              {busy === "remove" ? "Removing…" : "Remove map"}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)} className="h-11 text-danger">
            Remove map
          </button>
        ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
