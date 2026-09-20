/**
 * Loads migrations/*.sql into a throwaway in-memory SQLite database and asserts
 * that the rules the spec calls DECIDED are actually enforced by the schema
 * rather than merely intended.
 *
 * Run with: npm run db:verify
 *
 * This checks the schema, not the app. D1 is SQLite, so a constraint that holds
 * here holds there — but it does not prove the D1 binding works, which is what
 * the placeholder page at `/` is for.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
}

let passed = 0;
const failures = [];

/** The statement must succeed. */
function allows(what, sql) {
  try {
    db.exec(sql);
    passed++;
  } catch (error) {
    failures.push(`ALLOWS ${what} — but it was rejected: ${error.message}`);
  }
}

/** The statement must be rejected by a constraint or trigger. */
function rejects(what, sql) {
  try {
    db.exec(sql);
    failures.push(`REJECTS ${what} — but it was accepted`);
  } catch {
    passed++;
  }
}

// --- §2.1 the tree ---------------------------------------------------------
allows(
  "a site at the root",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES ('site-store', NULL, 'site', 'Store')`,
);
allows(
  "a second site",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES ('site-wh', NULL, 'site', 'Warehouse A')`,
);
rejects(
  "a site nested under another location",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES ('site-bad', 'site-store', 'site', 'Nested site')`,
);
rejects(
  "an unknown kind",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES ('bad-kind', NULL, 'aisle', 'Aisle')`,
);
rejects(
  "a location that is its own parent",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES ('loop', 'loop', 'node', 'Loop')`,
);
allows(
  "an arbitrarily deep chain of plain nodes (no fixed depth)",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES
     ('n1', 'site-store', 'node', 'Room 1'),
     ('n2', 'n1', 'node', 'Row 2'),
     ('n3', 'n2', 'node', 'Section 3'),
     ('n4', 'n3', 'node', 'Sub-section 4'),
     ('n5', 'n4', 'node', 'Sub-sub 5'),
     ('n6', 'n5', 'node', 'Deeper 6'),
     ('n7', 'n6', 'node', 'Deeper still 7')`,
);

// --- §4 addressing ---------------------------------------------------------
allows(
  "a shelf with an address",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-1', 'n3', 'shelf', 'Wall unit', 'Bulevard 1')`,
);
rejects(
  "a duplicate address in the same site",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-dup', 'n3', 'shelf', 'Other', 'Bulevard 1')`,
);
rejects(
  "the same address reused in a different site (uniqueness is global)",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-dup2', 'site-wh', 'shelf', 'Other', 'Bulevard 1')`,
);
rejects(
  "the same address in a different case",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-dup3', 'site-wh', 'shelf', 'Other', 'bulevard 1')`,
);
rejects(
  "an address on a plain node",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('nd-addr', 'n3', 'node', 'Row', 'Bulevard 9')`,
);
rejects(
  "an address on a site",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('st-addr', NULL, 'site', 'Site', 'Bulevard 8')`,
);
allows(
  "many shelves with no address yet (UNIQUE permits repeated NULLs)",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES
     ('sh-blank-1', 'n3', 'shelf', 'Unlabelled A'),
     ('sh-blank-2', 'n3', 'shelf', 'Unlabelled B')`,
);
allows(
  "a standalone shelf with no site above it (§2.1)",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-orphan', NULL, 'shelf', 'Loose unit', 'Kauppatori 4')`,
);

// --- §3 instructions, §5 map ----------------------------------------------
allows(
  "instructions on a shelf",
  `UPDATE locations SET instructions = '{"how_to_find":"grouped by publisher, not author"}' WHERE id = 'sh-1'`,
);
rejects(
  "instructions on a plain node",
  `UPDATE locations SET instructions = '{"x":1}' WHERE id = 'n3'`,
);
allows(
  "a reference map on a site",
  `UPDATE locations SET map_image_id = 'maps/store.jpg' WHERE id = 'site-store'`,
);
rejects(
  "a reference map on a shelf",
  `UPDATE locations SET map_image_id = 'maps/nope.jpg' WHERE id = 'sh-1'`,
);

// --- §2.2 editions ---------------------------------------------------------
allows(
  "a cached edition",
  `INSERT INTO editions (isbn13, title, author, source, fetched_at)
     VALUES ('9789510366868', 'Sinuhe egyptiläinen', 'Mika Waltari', 'finna', '2026-09-20T10:00:00Z')`,
);
rejects(
  "an edition from an unknown source",
  `INSERT INTO editions (isbn13, title, source) VALUES ('9780000000001', 'X', 'chatgpt')`,
);

// --- §2.3 copies -----------------------------------------------------------
allows(
  "a copy shelved at a shelf",
  `INSERT INTO copies (id, isbn13, location_id) VALUES ('c-1', '9789510366868', 'sh-1')`,
);
allows(
  "a copy shelved at a plain node",
  `INSERT INTO copies (id, isbn13, location_id) VALUES ('c-2', '9789510366868', 'n3')`,
);
allows(
  "many copies of the same edition (this is an index, not an inventory count)",
  `INSERT INTO copies (id, isbn13, location_id) VALUES
     ('c-3', '9789510366868', 'sh-1'),
     ('c-4', '9789510366868', 'sh-1'),
     ('c-5', '9789510366868', 'sh-orphan')`,
);
rejects(
  "a copy shelved directly at a site (§2.3)",
  `INSERT INTO copies (id, isbn13, location_id) VALUES ('c-bad', '9789510366868', 'site-store')`,
);
rejects(
  "moving an existing copy onto a site",
  `UPDATE copies SET location_id = 'site-store' WHERE id = 'c-1'`,
);
rejects(
  "an unknown status",
  `INSERT INTO copies (id, isbn13, location_id, status) VALUES ('c-bad2', '9789510366868', 'sh-1', 'lost')`,
);
rejects(
  "a copy pointing at an ISBN with no cached edition",
  `INSERT INTO copies (id, isbn13, location_id) VALUES ('c-bad3', '9780000000009', 'sh-1')`,
);
rejects(
  "deleting a location that still holds copies",
  `DELETE FROM locations WHERE id = 'sh-1'`,
);

// --- defaults --------------------------------------------------------------
{
  const row = db
    .prepare("SELECT status, added_at FROM copies c WHERE c.id = 'c-1'")
    .get();
  if (row.status !== "in_stock") failures.push(`status should default to in_stock, got ${row.status}`);
  else passed++;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.added_at))
    failures.push(`added_at should default to an ISO-8601 UTC string, got ${row.added_at}`);
  else passed++;
}

// --- report ----------------------------------------------------------------
console.log(`${passed} schema rules verified`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("schema matches the spec");
