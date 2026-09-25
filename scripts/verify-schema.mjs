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
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-1', 'n3', 'shelf', 'Wall unit', 'Bulevard 1', 'bulevard 1')`,
);
rejects(
  "a duplicate address in the same site",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-dup', 'n3', 'shelf', 'Other', 'Bulevard 1', 'bulevard 1')`,
);
rejects(
  "the same address reused in a different site (uniqueness is global)",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-dup2', 'site-wh', 'shelf', 'Other', 'Bulevard 1', 'bulevard 1')`,
);
rejects(
  "the same address in a different case",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-dup3', 'site-wh', 'shelf', 'Other', 'bulevard 1', 'bulevard 1b')`,
);
allows(
  "a Finnish address",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-fi', 'site-wh', 'shelf', 'Hylly', 'Ääkkönen 2', 'ääkkönen 2')`,
);
rejects(
  "the same Finnish address in a different case (NOCASE alone misses this; address_key catches it)",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-fi2', 'site-wh', 'shelf', 'Hylly', 'ÄÄKKÖNEN 2', 'ääkkönen 2')`,
);
rejects(
  "an address without its key",
  `INSERT INTO locations (id, parent_id, kind, label, address) VALUES ('sh-nokey', 'site-wh', 'shelf', 'X', 'Torikatu 7')`,
);
rejects(
  "a key without an address",
  `INSERT INTO locations (id, parent_id, kind, label, address_key) VALUES ('sh-nokey2', 'site-wh', 'shelf', 'X', 'torikatu 7')`,
);
rejects(
  "clearing an address but leaving its key behind",
  `UPDATE locations SET address = NULL WHERE id = 'sh-fi'`,
);
allows(
  "clearing an address together with its key",
  `UPDATE locations SET address = NULL, address_key = NULL WHERE id = 'sh-fi'`,
);
allows(
  "an address on a section (spec-corrections §9)",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('nd-addr', 'n3', 'node', 'Kids corner', 'Bulevard 9', 'bulevard 9')`,
);
rejects(
  "a section reusing a shelf's address (one pool for both)",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('nd-dup', 'n3', 'node', 'Table', 'Bulevard 1', 'bulevard 1')`,
);
rejects(
  "an address on a site",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('st-addr', NULL, 'site', 'Site', 'Bulevard 8', 'bulevard 8')`,
);
allows(
  "many shelves with no address yet (UNIQUE permits repeated NULLs)",
  `INSERT INTO locations (id, parent_id, kind, label) VALUES
     ('sh-blank-1', 'n3', 'shelf', 'Unlabelled A'),
     ('sh-blank-2', 'n3', 'shelf', 'Unlabelled B')`,
);
allows(
  "a standalone shelf with no site above it (§2.1)",
  `INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh-orphan', NULL, 'shelf', 'Loose unit', 'Kauppatori 4', 'kauppatori 4')`,
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
  "a price on a copy (dropped: locator, not a pricing tool)",
  `INSERT INTO copies (id, isbn13, location_id, price) VALUES ('c-bad2', '9789510366868', 'sh-1', 12.5)`,
);
rejects(
  "a stock status on a copy (dropped: the store's backend owns it)",
  `INSERT INTO copies (id, isbn13, location_id, status) VALUES ('c-bad4', '9789510366868', 'sh-1', 'sold')`,
);
allows(
  "a condition on a copy",
  `INSERT INTO copies (id, isbn13, location_id, condition) VALUES ('c-6', '9789510366868', 'sh-1', 'torn dust jacket')`,
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
    .prepare("SELECT added_at FROM copies c WHERE c.id = 'c-1'")
    .get();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.added_at))
    failures.push(`added_at should default to an ISO-8601 UTC string, got ${row.added_at}`);
  else passed++;
}

// --- 0003 over existing data ----------------------------------------------
// 0003 rebuilds `locations`, which other rows point at. Replay history up to
// 0002, add data shaped like production's (nested places, an address, books
// logged at a shelf), then apply 0003 the way D1 does — one transaction — and
// check nothing was lost or left dangling.
{
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const before = files.filter((f) => f < "0003");
  const rebuild = files.find((f) => f.startsWith("0003"));
  const old = new DatabaseSync(":memory:");
  old.exec("PRAGMA foreign_keys = ON;");
  for (const f of before) old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  old.exec(`
    INSERT INTO locations (id, parent_id, kind, label) VALUES ('s', NULL, 'site', 'Store');
    INSERT INTO locations (id, parent_id, kind, label) VALUES ('r', 's', 'node', 'Room');
    INSERT INTO locations (id, parent_id, kind, label, address, address_key, instructions)
      VALUES ('sh', 'r', 'shelf', 'Wall', 'Bulevard 1', 'bulevard 1', '{"how":"by publisher"}');
    INSERT INTO locations (id, parent_id, kind, label, sort_order) VALUES ('row', 'sh', 'node', 'Row 2', 3);
    INSERT INTO editions (isbn13, title) VALUES ('9789510366868', 'Sinuhe');
    INSERT INTO copies (id, isbn13, location_id, condition) VALUES ('c1', '9789510366868', 'row', 'good');
  `);
  // Column order may change in a rebuild; compare values by column name.
  const snapshot = (d) =>
    JSON.stringify(
      d.prepare("SELECT * FROM locations ORDER BY id").all().map((row) =>
        Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
      ),
    ) + JSON.stringify(d.prepare("SELECT * FROM copies ORDER BY id").all());
  const beforeRows = snapshot(old);
  try {
    old.exec(`BEGIN; ${readFileSync(join(MIGRATIONS, rebuild), "utf8")} COMMIT;`);
    passed++;
  } catch (error) {
    failures.push(`0003 applies over existing data — ${error.message}`);
  }
  const afterRows = snapshot(old);
  if (afterRows !== beforeRows) failures.push(`0003 changed existing rows:\n  ${beforeRows}\n  ${afterRows}`);
  else passed++;
  const dangling = old.prepare("PRAGMA foreign_key_check").all();
  if (dangling.length) failures.push(`0003 left broken references: ${JSON.stringify(dangling)}`);
  else passed++;
  try {
    old.exec(`INSERT INTO copies (id, location_id) VALUES ('c2', 's')`);
    failures.push("after 0003, the no-copies-at-a-site trigger still fires — but it was accepted");
  } catch {
    passed++;
  }
}

// --- report ----------------------------------------------------------------
console.log(`${passed} schema rules verified`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("schema matches the spec");
