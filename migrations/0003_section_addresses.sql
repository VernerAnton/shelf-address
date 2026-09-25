-- Sections may carry an address too. See docs/spec-corrections.md §9.
--
-- Until now `address` was shelf-only, enforced by a CHECK constraint. SQLite
-- can't change a CHECK constraint in place, so `locations` is rebuilt. The
-- rebuild also folds the address/address_key pairing (triggers since 0002)
-- into a plain CHECK, now that there's a CREATE TABLE to put it in.
--
-- `copies` and `locations` itself reference locations(id), and D1 always
-- enforces foreign keys. So nothing is ever left pointing at a missing row:
-- every row is set aside in a constraint-free holding table, the child rows
-- (copies) are emptied first, `locations` is dropped and created again under
-- its own name (no rename, which SQLite would refuse while `copies` triggers
-- mention `locations`), and the rows go back in parents-first.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE hold_locations AS SELECT * FROM locations;
CREATE TABLE hold_copies AS SELECT * FROM copies;

DELETE FROM copies;
DROP TABLE locations;

CREATE TABLE locations (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,

  -- Unique across every site; see 0001 for why NOCASE is kept alongside the
  -- stricter address_key below.
  address       TEXT UNIQUE COLLATE NOCASE,
  -- Normalised form uniqueness is really enforced on (lib/address.ts).
  address_key   TEXT UNIQUE,

  instructions  TEXT,     -- JSON, shelf-only. §3
  map_image_id  TEXT,     -- R2 object key, site-only. §5
  sort_order    INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT kind_is_known
    CHECK (kind IN ('site', 'shelf', 'node')),
  CONSTRAINT site_is_always_root
    CHECK (kind <> 'site' OR parent_id IS NULL),
  CONSTRAINT no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id),

  -- Changed: shelves AND sections may have an address; sites may not.
  CONSTRAINT address_is_not_on_sites
    CHECK (address IS NULL OR kind IN ('shelf', 'node')),
  CONSTRAINT address_key_goes_with_address
    CHECK ((address IS NULL) = (address_key IS NULL)),

  CONSTRAINT instructions_are_shelf_only
    CHECK (instructions IS NULL OR kind = 'shelf'),
  CONSTRAINT map_is_site_only
    CHECK (map_image_id IS NULL OR kind = 'site')
);

-- Parents before children, so every parent_id resolves as it's inserted.
INSERT INTO locations
  (id, parent_id, kind, label, address, address_key, instructions, map_image_id, sort_order)
WITH RECURSIVE ordered(id, depth) AS (
  SELECT id, 0 FROM hold_locations WHERE parent_id IS NULL
  UNION ALL
  SELECT h.id, ordered.depth + 1
  FROM hold_locations h JOIN ordered ON h.parent_id = ordered.id
)
SELECT h.id, h.parent_id, h.kind, h.label, h.address, h.address_key,
       h.instructions, h.map_image_id, h.sort_order
FROM ordered JOIN hold_locations h ON h.id = ordered.id
ORDER BY ordered.depth;

INSERT INTO copies (id, isbn13, location_id, condition, added_at)
  SELECT id, isbn13, location_id, condition, added_at FROM hold_copies;

DROP TABLE hold_locations;
DROP TABLE hold_copies;

CREATE INDEX idx_locations_parent ON locations(parent_id, sort_order);
CREATE INDEX idx_locations_kind ON locations(kind);
