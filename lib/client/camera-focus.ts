"use client";

/**
 * Focus for BookOps' camera (docs/spec-corrections.md §27). A webcam's
 * autofocus hunts for a while on every new book; on a stand the book is
 * always the same distance away, so the focus can be fixed instead.
 *
 * Only some cameras let the browser set focus (Chrome, a webcam whose driver
 * offers it); the rest keep their own autofocus. What a camera offers is read
 * from it, never assumed. The units of the distance are the camera's own.
 */

export type FocusRange = { min: number; max: number; step: number };
export type FocusSetting = { mode: "auto" | "fixed"; value: number };

type Caps = MediaTrackCapabilities & { focusMode?: string[]; focusDistance?: { min?: number; max?: number; step?: number } };
type Settings = MediaTrackSettings & { focusDistance?: number; focusMode?: string };

/** The focus distances the camera accepts, or null if the browser can't set its focus. */
export function focusRange(track: MediaStreamTrack | undefined): FocusRange | null {
  const caps = (track?.getCapabilities?.() ?? {}) as Caps;
  const d = caps.focusDistance;
  if (!caps.focusMode?.includes("manual") || typeof d?.min !== "number" || typeof d?.max !== "number" || d.max <= d.min) return null;
  return { min: d.min, max: d.max, step: d.step && d.step > 0 ? d.step : (d.max - d.min) / 100 };
}

/** Where the camera's focus is now (where autofocus has landed), within the range. */
export function currentFocus(track: MediaStreamTrack, range: FocusRange): number {
  const now = (track.getSettings?.() as Settings | undefined)?.focusDistance;
  return typeof now === "number" && now >= range.min && now <= range.max ? now : (range.min + range.max) / 2;
}

/** Fixes the focus at `value`, or gives it back to the camera's autofocus. Resolves false if the camera refused. */
export async function applyFocus(track: MediaStreamTrack, setting: FocusSetting): Promise<boolean> {
  const caps = (track.getCapabilities?.() ?? {}) as Caps;
  const constraint =
    setting.mode === "fixed"
      ? { focusMode: "manual", focusDistance: setting.value }
      : { focusMode: caps.focusMode?.includes("continuous") ? "continuous" : (caps.focusMode?.[0] ?? "continuous") };
  try {
    await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Keyed by the camera's name ("Logitech C920…"): its id can change from one visit to the next. */
const key = (camera: string) => `bookops:focus:${camera}`;

/** The focus chosen for this camera on this computer, if any. */
export function storedFocus(camera: string | null): FocusSetting | null {
  if (!camera) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key(camera)) ?? "null") as FocusSetting | null;
    return v && (v.mode === "auto" || v.mode === "fixed") && typeof v.value === "number" ? v : null;
  } catch {
    return null;
  }
}

export function rememberFocus(camera: string | null, setting: FocusSetting) {
  if (!camera) return;
  try {
    localStorage.setItem(key(camera), JSON.stringify(setting));
  } catch {
    // Not remembered, that's all.
  }
}
