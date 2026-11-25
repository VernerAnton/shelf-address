/**
 * BookOps' connection to the web store (docs/spec-corrections.md §30).
 *
 * A STAND-IN for now: nothing leaves the app. It behaves like a real
 * connection — it takes a moment, answers with a listing reference, and a
 * listing can be taken back — so the whole flow can be tried out before the
 * real one exists. When the store's API is known, these two functions are the
 * only place that changes; `STORE_IS_STAND_IN` then goes false and the screen
 * stops saying "test connection".
 */

export const STORE_IS_STAND_IN = true;

/** Exactly what would be sent: the accepted book, as it stands. */
export type StoreListing = {
  id: string;
  isbn13: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  year: string | null;
  description: string | null;
  priceCents: number;
  condition: string;
  quantity: number;
  /** R2 key of the front photo, the listing's picture. */
  photo: string | null;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lists the book in the web store; answers with the store's reference for it. */
export async function sendToStore(listing: StoreListing): Promise<{ ref: string }> {
  void listing; // the real connection sends this
  await pause(700);
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return { ref: `TEST-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}` };
}

/** Takes a listing back out of the web store. */
export async function removeFromStore(ref: string): Promise<void> {
  void ref; // the real connection removes this listing
  await pause(300);
}
