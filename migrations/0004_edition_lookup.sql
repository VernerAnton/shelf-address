-- Phase 4: book lookup, barcode-less books, catalog search.
-- See docs/spec-corrections.md §12.
--
-- editions.isbn13 is the edition's key. For a book with a barcode it's the
-- ISBN-13, as before. For one without, it's `finna:<Finna record id>` (picked
-- from a Finna search) or `manual:<uuid>` (typed in by hand). The column keeps
-- its name: renaming it would mean rebuilding both tables for no behaviour
-- change, and every existing row is still a real ISBN-13.
--
-- All additions are plain ADD COLUMNs with defaults, so existing rows are
-- untouched and valid.

-- Where the lookup chain (Finna → Google Books → Open Library) stands:
--   pending    not tried yet, or the last try failed temporarily — retried
--   found      metadata filled in from `source`
--   not_found  every source was asked and none knew the book
--   skipped    typed in by hand; nothing to look up
ALTER TABLE editions ADD COLUMN lookup_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (lookup_status IN ('pending', 'found', 'not_found', 'skipped'));
ALTER TABLE editions ADD COLUMN lookup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE editions ADD COLUMN last_attempt_at TEXT;

-- Typed-in or otherwise uncertain editions to check later (spec §2.2 open
-- item: pre-ISBN stock gets a "needs review" flag).
ALTER TABLE editions ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0
  CHECK (needs_review IN (0, 1));

-- Lower-cased title, authors and ISBN for Catalog search, written by the app
-- (lib/search.ts) with Finnish-aware case folding that SQLite's LIKE lacks.
ALTER TABLE editions ADD COLUMN search_text TEXT;

CREATE INDEX idx_editions_lookup ON editions(lookup_status, last_attempt_at);
CREATE INDEX idx_editions_review ON editions(needs_review);
