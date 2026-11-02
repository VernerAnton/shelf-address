-- Saved texts (docs/spec-corrections.md §24): every text read in Extract on a
-- phone logged in to AI reading is kept here, so it can be picked up on the
-- computer — no sharing step. Kept 30 days after its last change.
CREATE TABLE saved_texts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  -- ai: read by the AI; phone: by the phone's own reader (the backup).
  source TEXT NOT NULL CHECK (source IN ('ai', 'phone')),
  created_at TEXT NOT NULL,
  -- When it was last changed on the phone (the phone's clock): a late upload
  -- of an older version never overwrites a newer one.
  updated_at TEXT NOT NULL,
  -- Ticked on the computer once it's been used.
  done_at TEXT
);

CREATE INDEX saved_texts_created ON saved_texts (created_at);
