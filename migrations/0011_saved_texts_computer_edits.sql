-- Saved texts can be corrected on the computer (docs/spec-corrections.md §26).
-- Once they are, the computer's version wins: later saves from the phone are
-- refused, so a late tap on the phone can't undo the computer's corrections.
ALTER TABLE saved_texts ADD COLUMN edited_on_computer_at TEXT;
