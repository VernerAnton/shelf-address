"use server";

import { redirect } from "next/navigation";
import { CopyError, deleteCopy, getCopy, moveCopy, setCondition } from "@/lib/copies";
import type { MoveState } from "@/app/sections/actions";

export type ConditionState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

export async function setConditionAction(
  _previous: ConditionState,
  formData: FormData,
): Promise<ConditionState> {
  try {
    await setCondition(String(formData.get("id") ?? ""), String(formData.get("condition") ?? ""));
    return { status: "saved" };
  } catch (error) {
    if (error instanceof CopyError) return { status: "error", message: error.message };
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
