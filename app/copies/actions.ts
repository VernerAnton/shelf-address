"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { CopyError, checkDetails, deleteCopy, getCopy, moveCopy, reassignCopy, setCondition } from "@/lib/copies";
import { kickLookups, markReviewed, retryLookup, saveEditionDetails } from "@/lib/editions";
import type { MoveState } from "@/app/sections/actions";

/** `condition` is what's saved, so the chips show the result of each tap. */
export type ConditionState =
  | { status: "idle" | "saved"; condition: string | null }
  | { status: "error"; condition: string | null; message: string };

export async function setConditionAction(
  previous: ConditionState,
  formData: FormData,
): Promise<ConditionState> {
  const condition = String(formData.get("condition") ?? "") || null;
  try {
    await setCondition(String(formData.get("id") ?? ""), condition);
    return { status: "saved", condition };
  } catch (error) {
    if (error instanceof CopyError) {
      return { status: "error", condition: previous.condition, message: error.message };
    }
    throw error;
  }
}

export async function moveCopyAction(_previous: MoveState, formData: FormData): Promise<MoveState> {
  const id = String(formData.get("id") ?? "");
  try {
    await moveCopy(id, String(formData.get("targetId") ?? ""));
  } catch (error) {
    if (error instanceof CopyError) return { status: "error", message: error.message };
    throw error;
  }
  redirect(`/copies/${id}`);
}

export type DeleteCopyState = { status: "idle" } | { status: "error"; message: string };

export async function deleteCopyAction(
  _previous: DeleteCopyState,
  formData: FormData,
): Promise<DeleteCopyState> {
  const id = String(formData.get("id") ?? "");
  const copy = await getCopy(id);
  try {
    await deleteCopy(id);
  } catch (error) {
    if (error instanceof CopyError) return { status: "error", message: error.message };
    throw error;
  }
  redirect(copy ? `/sections/${copy.locationId}` : "/sections");
}

/** "Try again" on a book whose lookup hasn't succeeded. Runs it now. */
export async function retryLookupAction(formData: FormData): Promise<void> {
  await retryLookup(String(formData.get("key") ?? ""));
  refresh();
}

export type DetailsState = { status: "idle" } | { status: "error"; message: string } | { status: "saved" };

/** Title/author/year typed in by hand; stays flagged unless marked reviewed. */
export async function saveDetailsAction(_previous: DetailsState, formData: FormData): Promise<DetailsState> {
  const key = String(formData.get("key") ?? "");
  try {
    const details = checkDetails(
      { title: formData.get("title"), author: formData.get("author"), year: formData.get("year") },
      { requireTitle: true },
    )!;
    await saveEditionDetails(
      key,
      { title: details.title, author: details.author, year: details.year },
      { reviewed: formData.get("reviewed") === "on" },
    );
  } catch (error) {
    if (error instanceof CopyError) return { status: "error", message: error.message };
    throw error;
  }
  refresh();
  return { status: "saved" };
}

export async function markReviewedAction(formData: FormData): Promise<void> {
  await markReviewed(String(formData.get("key") ?? ""));
  refresh();
}

export type ReassignState = { status: "idle" } | { status: "error"; message: string };

/**
 * "Wrong book?" — re-points a copy (and optionally every copy with the same
 * barcode) at the book it really is. A typed-in book gets a fresh manual key.
 */
export async function reassignAction(_previous: ReassignState, formData: FormData): Promise<ReassignState> {
  const copyId = String(formData.get("copyId") ?? "");
  const rawKey = String(formData.get("key") ?? "");
  const key = rawKey === "manual:new" ? `manual:${crypto.randomUUID()}` : rawKey;
  const year = String(formData.get("year") ?? "");
  try {
    await reassignCopy(
      copyId,
      {
        key,
        details: {
          title: formData.get("title"),
          author: formData.get("author"),
          publisher: formData.get("publisher"),
          year: year ? Number(year) : null,
        },
      },
      { sameBarcode: formData.get("sameBarcode") === "on" },
    );
  } catch (error) {
    if (error instanceof CopyError) return { status: "error", message: error.message };
    throw error;
  }
  await kickLookups(key);
  redirect(`/copies/${copyId}`);
}
