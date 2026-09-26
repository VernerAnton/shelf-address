"use client";

import { useState } from "react";

/**
 * The map photo. Tap to switch between fitting the screen and full size
 * (scroll around it); pinch-zoom works too.
 */
export function MapView({ src, alt }: { src: string; alt: string }) {
  const [full, setFull] = useState(false);
  return (
    <div className={`overflow-auto rounded-xl border border-line bg-surface ${full ? "max-h-[75dvh]" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served from R2, already sized */}
      <img
        src={src}
        alt={alt}
        onClick={() => setFull((f) => !f)}
        className={full ? "max-w-none cursor-zoom-out" : "h-auto w-full cursor-zoom-in"}
      />
    </div>
  );
}
