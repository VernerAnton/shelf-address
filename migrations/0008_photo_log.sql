-- Photo log (docs/spec-corrections.md §21): every photo taken with "Camera
-- struggling? Take a photo", with what the app made of it, to find out why
-- reading printed ISBNs fails on real phones. Temporary troubleshooting data:
-- entries older than 30 days are deleted (with their photos in R2) whenever a
-- new one arrives.
CREATE TABLE photo_log (
  id TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  -- The app screen the photo was taken on: /scan, /evaluate.
  screen TEXT NOT NULL,
  -- barcode: a barcode read from it; isbn: one printed ISBN read;
  -- several: several ISBNs offered; none: nothing found; error: reading broke;
  -- lost: the photo never reached the app (the phone closed it meanwhile).
  outcome TEXT NOT NULL CHECK (outcome IN ('barcode', 'isbn', 'several', 'none', 'error', 'lost')),
  isbns TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  -- Everything the text reader saw, per orientation tried.
  ocr_text TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  mime TEXT,
  user_agent TEXT,
  app_version INTEGER,
  photo_key TEXT,
  thumb_key TEXT
);

CREATE INDEX photo_log_taken ON photo_log (taken_at);
