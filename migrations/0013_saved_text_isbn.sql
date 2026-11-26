-- A saved text's book ISBN (docs/spec-corrections.md §35): from the barcode or
-- the printed number on a photo, read on the phone, or typed. Copied on the
-- computer into a listing.
ALTER TABLE saved_texts ADD COLUMN isbn TEXT;
-- barcode | ai | typed
ALTER TABLE saved_texts ADD COLUMN isbn_source TEXT;
