-- Saved texts get their photos (docs/spec-corrections.md §28).
--
-- The book's front cover, photographed on the phone after the back text, to
-- copy on the computer straight into a listing. One per text; a new photo
-- replaces it. The picture is in R2 at cover_key.
ALTER TABLE saved_texts ADD COLUMN cover_key TEXT;
ALTER TABLE saved_texts ADD COLUMN cover_at TEXT;

-- Each back-cover photo the AI read for a text, with exactly what it answered,
-- so a bad reading can be reported from the computer too. Deleted with the
-- text (and their photos in R2 with them).
CREATE TABLE saved_text_readings (
  id TEXT PRIMARY KEY,
  text_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  photo_key TEXT,
  reply TEXT NOT NULL,
  -- How the reading went (model, why it stopped, tokens, time), as JSON.
  details TEXT
);

CREATE INDEX saved_text_readings_text ON saved_text_readings (text_id, read_at);
