-- Cover photos taken on the phone (docs/spec-corrections.md §15).
--
-- A cover photographed by hand is the right edition by definition, so a later
-- lookup must never replace it. This flag marks it; the lookup leaves
-- cover_url alone while it's set.

ALTER TABLE editions ADD COLUMN cover_by_hand INTEGER NOT NULL DEFAULT 0
  CHECK (cover_by_hand IN (0, 1));
