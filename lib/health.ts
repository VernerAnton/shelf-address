import { getBucket, getDb } from "@/lib/cloudflare";

export type BindingStatus =
  | { ok: true; detail: string }
  | { ok: false; detail: string };

export type Health = {
  d1: BindingStatus;
  r2: BindingStatus;
  tables: { name: string; rows: number }[];
};

const EXPECTED_TABLES = ["locations", "editions", "copies"] as const;

/**
 * Proves the Phase 1 plumbing end to end: the D1 binding resolves, the schema
 * from §2 is actually applied, and the R2 binding answers. Used by the
 * placeholder page so a deploy is verified rather than merely rendering.
 */
export async function checkBindings(): Promise<Health> {
  const health: Health = {
    d1: { ok: false, detail: "not checked" },
    r2: { ok: false, detail: "not checked" },
    tables: [],
  };

  try {
    const db = await getDb();
    for (const name of EXPECTED_TABLES) {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${name}`)
        .first<{ n: number }>();
      health.tables.push({ name, rows: row?.n ?? 0 });
    }
    health.d1 = { ok: true, detail: "connected, schema applied" };
  } catch (error) {
    health.d1 = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const bucket = await getBucket();
    const listed = await bucket.list({ limit: 1 });
    health.r2 = {
      ok: true,
      detail: `bound, ${listed.objects.length === 0 ? "empty" : "has objects"}`,
    };
  } catch (error) {
    health.r2 = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return health;
}
