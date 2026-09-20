-- Shelf-Address initial schema. Implements spec §2.
--
-- Type note: D1 is SQLite. The spec writes JSON / TIMESTAMP / NUMERIC, which
-- SQLite has no native types for. Mapping used throughout:
--   JSON      -> TEXT holding a serialised JSON document
--   TIMESTAMP -> TEXT holding an ISO-8601 UTC string
--   NUMERIC   -> NUMERIC (a real SQLite affinity; kept as the spec writes it)

-- ---------------------------------------------------------------------------
-- §2.1 Locations: self-referencing tree, unbounded depth.
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  kind          TEXT NOT NULL,
  label         TEXT NOT NULL,

  -- Globally unique across every site. COLLATE NOCASE so "Bulevard 1" and
  -- "bulevard 1" collide rather than becoming two addresses. UNIQUE permits
  -- many NULLs, which is what we want: only shelves carry an address, and a
  -- shelf may exist before one is assigned.
  address       TEXT UNIQUE COLLATE NOCASE,

  instructions  TEXT,     -- JSON, shelf-only. §3
  map_image_id  TEXT,     -- R2 object key, site-only. §5
  sort_order    INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT kind_is_known
    CHECK (kind IN ('site', 'shelf', 'node')),

  -- §2.1: a site is always root. Deliberately NOT the converse — the spec's
  -- argument for an explicit `kind` tag is precisely that "a standalone shelf
  -- doesn't sit under any site", so shelf/node are allowed to be parentless.
  CONSTRAINT site_is_always_root
    CHECK (kind <> 'site' OR parent_id IS NULL),

  CONSTRAINT no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id),

  -- §3, §4: address and instructions belong to shelves only.
  CONSTRAINT address_is_shelf_only
    CHECK (address IS NULL OR kind = 'shelf'),
  CONSTRAINT instructions_are_shelf_only
    CHECK (instructions IS NULL OR kind = 'shelf'),

  -- §5: the reference map belongs to sites only.
  CONSTRAINT map_is_site_only
    CHECK (map_image_id IS NULL OR kind = 'site')
);

CREATE INDEX idx_locations_parent ON locations(parent_id, sort_order);
CREATE INDEX idx_locations_kind ON locations(kind);

-- ---------------------------------------------------------------------------
-- §2.2 Editions: ISBN metadata cache.
-- ---------------------------------------------------------------------------
-- isbn13 is intentionally left unconstrained in shape. Pre-ISBN-era stock is
-- an open item in the spec (§2.2, §9 item 1) and a digit-count CHECK now would
-- have to be migrated away the moment that gets designed.
CREATE TABLE editions (
  isbn13      TEXT PRIMARY KEY,
  title       TEXT,
  author      TEXT,
  publisher   TEXT,
  year        INTEGER,
  edition     TEXT,
  categories  TEXT,
  language    TEXT,
  cover_url   TEXT,     -- R2 object key, never a hotlink to the source. §2.2
  source      TEXT,
  fetched_at  TEXT,     -- ISO-8601 UTC

  CONSTRAINT source_is_known
    CHECK (source IS NULL OR source IN ('finna', 'google_books', 'open_library', 'manual'))
);

-- ---------------------------------------------------------------------------
-- §2.3 Copies: individual physical items.
-- ---------------------------------------------------------------------------
CREATE TABLE copies (
  id           TEXT PRIMARY KEY,
  isbn13       TEXT REFERENCES editions(isbn13) ON DELETE RESTRICT,
  location_id  TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  condition    TEXT,
  price        NUMERIC,
  status       TEXT NOT NULL DEFAULT 'in_stock',
  added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  CONSTRAINT status_is_known
    CHECK (status IN ('in_stock', 'sold', 'reserved'))
);

CREATE INDEX idx_copies_location ON copies(location_id);
CREATE INDEX idx_copies_isbn ON copies(isbn13);
CREATE INDEX idx_copies_status ON copies(status);

-- §2.3: a copy lives at a 'node' or 'shelf', never at a 'site'. This can't be
-- a CHECK constraint (SQLite forbids subqueries there), so it's a trigger pair.
CREATE TRIGGER copies_location_not_site_insert
BEFORE INSERT ON copies
WHEN NEW.location_id IS NOT NULL
  AND (SELECT kind FROM locations WHERE id = NEW.location_id) = 'site'
BEGIN
  SELECT RAISE(ABORT, 'a copy cannot be shelved directly at a site');
END;

CREATE TRIGGER copies_location_not_site_update
BEFORE UPDATE OF location_id ON copies
WHEN NEW.location_id IS NOT NULL
  AND (SELECT kind FROM locations WHERE id = NEW.location_id) = 'site'
BEGIN
  SELECT RAISE(ABORT, 'a copy cannot be shelved directly at a site');
END;
