-- Phase 5: instruction panels (spec §3). See docs/spec-corrections.md §14.
--
-- One panel per shelf, and per section that has an address. Kept in its own
-- table rather than locations.instructions: that column's CHECK allows shelves
-- only, and widening it would mean rebuilding `locations` again (as 0003 had
-- to). A separate row also carries the "last updated" date shown on the panel.
-- locations.instructions stays, unused.
--
-- Which places may have a panel is decided by the app (a shelf, or a section
-- with an address) — a rule spanning a row's kind and address that a CHECK on
-- this table can't see. A panel whose place later stops qualifying (a section
-- losing its address) is kept but not shown, so nothing typed is lost.

CREATE TABLE panels (
  location_id  TEXT PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
  -- "How to find a book here": the worked example (§3).
  how_to_find  TEXT,
  -- JSON object: { "<location id of a place inside>": "note", ... }.
  notes        TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL
);
