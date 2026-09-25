"use server";

import { redirect } from "next/navigation";
import { addressKey } from "@/lib/address";
import {
  ADDRESS_MAX,
  LABEL_MAX,
  LocationError,
  checkAddress,
  createLocation,
  deleteLocation,
  getLocation,
  updateLocation,
  type AddressHolder,
  type LocationKind,
} from "@/lib/locations";

export type FormValues = {
  label: string;
  kind: LocationKind;
  address: string;
};

export type LocationFormState =
  | { status: "idle" }
  | { status: "error"; message: string; values: FormValues }
  | { status: "taken"; holder: AddressHolder; values: FormValues }
  | { status: "similar"; matches: AddressHolder[]; values: FormValues };

const KINDS: LocationKind[] = ["site", "shelf", "node"];

function readValues(formData: FormData): FormValues {
  const kind = String(formData.get("kind") ?? "");
  return {
    label: String(formData.get("label") ?? "").trim(),
    kind: (KINDS as string[]).includes(kind) ? (kind as LocationKind) : "node",
    address: String(formData.get("address") ?? "").trim(),
  };
}

/**
 * Checks shared by create and edit. Returns a state to show the person, or
 * null when it's fine to write. `confirm` records which warning, if any, the
 * person already said yes to:
 *   "take"    — move the address here from the shelf that holds it
 *   "similar" — save even though it resembles an existing address
 */
async function validate(
  values: FormValues,
  confirm: string,
  excludeId: string | null,
  previousAddress: string | null,
): Promise<LocationFormState | null> {
  if (!values.label) {
    return { status: "error", message: "Give it a name.", values };
  }
  if (values.label.length > LABEL_MAX) {
    return { status: "error", message: `Keep the name under ${LABEL_MAX} characters.`, values };
  }
  if (values.kind !== "shelf") return null;

  if (!values.address) {
    return { status: "error", message: "A shelf needs an address.", values };
  }
  if (values.address.length > ADDRESS_MAX) {
    return { status: "error", message: `Keep the address under ${ADDRESS_MAX} characters.`, values };
  }

  // Unchanged address: nothing to re-check, and re-raising a "similar"
  // warning the person already accepted would just be noise.
  if (previousAddress && addressKey(previousAddress) === addressKey(values.address)) {
    return null;
  }

  const check = await checkAddress(values.address, excludeId);
  if (check.status === "taken" && confirm !== "take") {
    return { status: "taken", holder: check.holder, values };
  }
  if (check.status === "similar" && confirm !== "similar" && confirm !== "take") {
    return { status: "similar", matches: check.matches, values };
  }
  return null;
}

function hrefFor(id: string | null): string {
  return id ? `/sections/${id}` : "/sections";
}

export async function createLocationAction(
  _previous: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const parentId = String(formData.get("parentId") ?? "") || null;
  const confirm = String(formData.get("confirm") ?? "");
  const values = readValues(formData);

  const problem = await validate(values, confirm, null, null);
  if (problem) return problem;

  try {
    await createLocation(
      parentId,
      { label: values.label, kind: values.kind, address: values.address || null },
      { takeAddress: confirm === "take" },
    );
  } catch (error) {
    if (error instanceof LocationError) {
      return { status: "error", message: error.message, values };
    }
    throw error;
  }

  // Back to where it was added, so the next sibling ("Section 2", "Section
  // 3", ...) is one tap away.
  redirect(hrefFor(parentId));
}

export async function updateLocationAction(
  _previous: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const id = String(formData.get("id") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const values = readValues(formData);

  const current = await getLocation(id);
  if (!current) {
    return { status: "error", message: "This location no longer exists.", values };
  }

  const problem = await validate(values, confirm, id, current.address);
  if (problem) return problem;

  try {
    await updateLocation(
      id,
      { label: values.label, kind: values.kind, address: values.address || null },
      { takeAddress: confirm === "take" },
    );
  } catch (error) {
    if (error instanceof LocationError) {
      return { status: "error", message: error.message, values };
    }
    throw error;
  }

  redirect(hrefFor(id));
}

export type DeleteState = { status: "idle" } | { status: "error"; message: string };

export async function deleteLocationAction(
  _previous: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const id = String(formData.get("id") ?? "");
  let parentId: string | null;
  try {
    ({ parentId } = await deleteLocation(id));
  } catch (error) {
    if (error instanceof LocationError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
  redirect(hrefFor(parentId));
}
