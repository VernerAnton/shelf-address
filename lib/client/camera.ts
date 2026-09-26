"use client";

/**
 * One camera, two users: the barcode scanner and the cover camera. Opening the
 * cover camera claims the camera; the scanner stops, and starts again (if it
 * was running) when the cover camera releases it.
 */

const EVENT = "shelf-camera";

export function claimCamera(): () => void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "claim" }));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: "release" }));
  };
}

export function onCameraClaims(handlers: { claim: () => void; release: () => void }): () => void {
  const listener = (event: Event) => {
    const kind = (event as CustomEvent<string>).detail;
    if (kind === "claim") handlers.claim();
    else if (kind === "release") handlers.release();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
