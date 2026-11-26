-- A second ISBN for books that print two (docs/spec-corrections.md §36), e.g.
-- one per binding. Copied on the computer like the first.
ALTER TABLE saved_texts ADD COLUMN isbn2 TEXT;
