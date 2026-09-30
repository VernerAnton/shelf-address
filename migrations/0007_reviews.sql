-- Review mode (docs/spec-corrections.md §16).
--
-- A review of a place compares what's logged there with what's scanned.
-- Copies logged there but not scanned are marked, not deleted: they may just
-- have wandered a few rows. `missing_since` is when a review first didn't find
-- the copy; it's cleared when the copy turns up (scanned in a review, or
-- confirmed as "that copy" when scanned elsewhere) and gone with the copy
-- when it's removed as sold.
ALTER TABLE copies ADD COLUMN missing_since TEXT;

-- When the place was last reviewed, shown on its page.
ALTER TABLE locations ADD COLUMN reviewed_at TEXT;

-- The missing list is read on every scan-tab refresh.
CREATE INDEX copies_missing ON copies (missing_since) WHERE missing_since IS NOT NULL;
