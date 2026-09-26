"use client";

import { useState } from "react";
import { EditionFinder } from "@/components/edition-finder";
import { logScan } from "@/lib/client/scan-store";

type Props = {
  disabled: boolean;
  online: boolean;
  /** Called with the logged book's title, for the "Logged …" line. */
  onPicked: (label: string) => void;
};

/**
 * Logging a book with no barcode (spec §2.2 open item; spec-corrections §12):
 * find it in Finna by title/author, or type it in by hand ("needs review").
 */
export function NoBarcode({ disabled, online, onPicked }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="h-12 rounded-xl border border-line bg-surface font-medium disabled:opacity-40"
      >
        No barcode? Find the book by title
      </button>
    );
  }

  return (
    <EditionFinder
      heading="Book without a barcode"
      online={online}
      onCancel={() => setOpen(false)}
      onChoose={async ({ key, details, label }) => {
        await logScan(key === "manual:new" ? `manual:${crypto.randomUUID()}` : key, details);
        onPicked(label);
        setOpen(false);
      }}
    />
  );
}
