/**
 * Copy rules shared by the server and the Scan screen (no server imports).
 *
 * Condition is one of the store's own grades, K1–K5, so every copy is graded
 * the same way and a grade is one tap while scanning. See
 * docs/spec-corrections.md §11.
 */
export const CONDITIONS = ["K1", "K2", "K3", "K4", "K5"] as const;

export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}
