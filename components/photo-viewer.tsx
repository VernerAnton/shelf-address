"use client";

import { useEffect, useRef } from "react";

/**
 * A photo shown large, over the page (docs/spec-corrections.md §27). Closes
 * with ✕, Esc, or a click anywhere outside the photo — a plain link to the
 * image file left the installed app on a bare picture with no way back.
 */
export function PhotoViewer({ photo, onClose }: { photo: { src: string; caption: string } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (photo && !dialog.open) dialog.showModal();
    if (!photo && dialog.open) dialog.close();
  }, [photo]);

  return (
    <dialog
      ref={ref}
      aria-label={photo?.caption ?? "Photo"}
      onClose={onClose}
      // A click on the dark backdrop (the dialog itself, not what's inside it) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80"
    >
      {photo && (
        <div className="flex max-h-[94vh] max-w-[94vw] flex-col items-center gap-2" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="flex w-full items-center justify-between gap-4 text-white">
            <p className="min-w-0 truncate text-sm">{photo.caption}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              autoFocus
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-sm font-medium text-white hover:bg-white/25"
            >
              ✕ Close <kbd className="font-sans text-xs text-white/70">Esc</kbd>
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.src} alt={photo.caption} className="max-h-[85vh] max-w-[94vw] rounded-md object-contain" />
        </div>
      )}
    </dialog>
  );
}
