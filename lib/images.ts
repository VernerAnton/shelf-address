/**
 * Checks for images uploaded from the phone (map photos, cover photos): the
 * content type must be one we store, and the first bytes must really be that
 * kind of image.
 */

export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function looksLike(type: string, bytes: Uint8Array): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, j) => bytes[i + j] === v);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return false;
}

/** Why an upload can't be stored, or null if it can. */
export function imageProblem(type: string, body: ArrayBuffer, maxBytes: number): string | null {
  if (!IMAGE_TYPES[type]) return "That isn't a photo this can store (JPEG, PNG or WebP).";
  if (body.byteLength === 0) return "The photo arrived empty. Try again.";
  if (body.byteLength > maxBytes) return "That photo is too large. Try a smaller one.";
  if (!looksLike(type, new Uint8Array(body, 0, Math.min(12, body.byteLength)))) return "That file doesn't look like a photo.";
  return null;
}
