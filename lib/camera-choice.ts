/**
 * Which camera to scan with. Phones with several back lenses (main, ultra-wide,
 * macro, telephoto) don't always hand the browser the main one, and the
 * others are bad at barcodes: an ultra-wide is soft close up, and a macro lens
 * (like the 2 MP one on a Samsung Galaxy A26) is fixed-focus at a few cm, so
 * everything at reading distance is a blur.
 *
 * Pure functions over the browser's device list, so they can be unit tested.
 * Labels are only filled in once the camera has been allowed.
 */

export type CameraDevice = { deviceId: string; label: string };

const BACK = /back|rear|environment|facing back/i;
const FRONT = /front|user|facing front|selfie/i;
/** Lenses that aren't the main one: avoided unless there's nothing else. */
const SECONDARY = /ultra|wide|macro|tele|depth|zoom|dual|triple|\buw\b/i;

/** Android numbers its lenses "camera2 0", "camera2 2"…: the main one is lowest. */
function lensNumber(label: string): number {
  const m = label.match(/camera2?\s*(\d+)/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** The back cameras, best first: main lens before ultra-wide, macro and the like. */
export function backCameras(devices: CameraDevice[]): CameraDevice[] {
  const labelled = devices.filter((d) => d.label);
  const back = labelled.filter((d) => BACK.test(d.label) && !FRONT.test(d.label));
  return back
    .map((device, index) => ({ device, index }))
    .sort(
      (a, b) =>
        Number(SECONDARY.test(a.device.label)) - Number(SECONDARY.test(b.device.label)) ||
        lensNumber(a.device.label) - lensNumber(b.device.label) ||
        a.index - b.index,
    )
    .map(({ device }) => device);
}

/** The main back camera's id, or null if the labels don't say (use "environment" then). */
export function pickMainCamera(devices: CameraDevice[]): string | null {
  return backCameras(devices)[0]?.deviceId ?? null;
}

/** Zoom steps worth offering, within what the camera allows: 1×, 2×, 3×. */
export function zoomSteps(range: { min: number; max: number } | null): number[] {
  if (!range || range.max < 1.5) return [];
  return [1, 2, 3].filter((z) => z >= range.min && z <= range.max);
}
