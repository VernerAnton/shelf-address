-- Scope correction: Shelf-Address is a location locator, not a pricing or
-- stock-tracking tool. See docs/spec-corrections.md §4.
--
-- 1. copies loses `price` and `status`. The store's own backend owns both;
--    keeping a second copy here would let two systems disagree. `condition`
--    stays, because condition can decide which shelf a copy goes on.
--
-- 2. locations gains `address_key`, the normalised form of `address` that
--    global uniqueness is actually enforced on. SQLite's NOCASE only folds
--    A-Z, so "Ä" and "ä" slipped past the 0001 constraint. The application
--    computes the key (lib/address.ts) with full Unicode case folding and
--    whitespace collapsing; the database guarantees it is unique and present
--    whenever an address is.

-- ---------------------------------------------------------------------------
-- 1. Rebuild copies without price/status.
-- ---------------------------------------------------------------------------
-- A table rebuild rather than ALTER TABLE DROP COLUMN: SQLite refuses to drop
-- a column that a CHECK constraint or an index refers to, and `status` has
-- both. Nothing references copies, so it can be dropped and recreated freely.

DROP TRIGGER copies_location_not_site_insert;
DROP TRIGGER copies_location_not_site_update;

CREATE TABLE copies_new (
  id           TEXT PRIMARY KEY,
  isbn13       TEXT REFERENCES editions(isbn13) ON DELETE RESTRICT,
  location_id  TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  condition    TEXT,
  added_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO copies_new (id, isbn13, location_id, condition, added_at)
  SELECT id, isbn13, location_id, condition, added_at FROM copies;

DROP TABLE copies;
ALTER TABLE copies_new RENAME TO copies;

CREATE INDEX idx_copies_location ON copies(location_id);
CREATE INDEX idx_copies_isbn ON copies(isbn13);

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

-- ---------------------------------------------------------------------------
-- 2. address_key on locations.
-- ---------------------------------------------------------------------------
ALTER TABLE locations ADD COLUMN address_key TEXT;

-- Existing rows (none in production at time of writing) get the best key
-- SQLite can compute on its own; the app rewrites keys on every save.
UPDATE locations SET address_key = lower(trim(address)) WHERE address IS NOT NULL;

CREATE UNIQUE INDEX idx_locations_address_key ON locations(address_key);

-- address and address_key are set and cleared together. ALTER TABLE cannot
-- add a CHECK constraint to an existing table, hence triggers.
CREATE TRIGGER locations_address_key_insert
BEFORE INSERT ON locations
WHEN (NEW.address IS NULL) <> (NEW.address_key IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'address and address_key must be set together');
END;

CREATE TRIGGER locations_address_key_update
BEFORE UPDATE OF address, address_key ON locations
WHEN (NEW.address IS NULL) <> (NEW.address_key IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'address and address_key must be set together');
END;
