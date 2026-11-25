-- BookOps (docs/spec-corrections.md §30): books photographed at the desk
-- (front and back cover), filled in from the book databases and by the AI,
-- priced by hand, then sent to the web store.
--
-- Its own table on purpose: nothing here touches the catalog (editions,
-- copies, locations). Photos are in R2 under bookops/.
CREATE TABLE bookops_books (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- draft: being worked on; listed: sent to the web store.
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'listed')),

  -- Each filled-in field remembers where its text came from, in *_source:
  --   barcode / typed   the ISBN: read from the barcode, or typed in the ISBN box
  --   finna / google_books / open_library   a book database, by ISBN
  --   ai                read off the photos — to be checked
  --   you               typed at the desk — never overwritten afterwards
  isbn13 TEXT,
  isbn_source TEXT CHECK (isbn_source IN ('barcode', 'typed', 'ai', 'you')),
  title TEXT,
  title_source TEXT CHECK (title_source IN ('finna', 'google_books', 'open_library', 'ai', 'you')),
  author TEXT,
  author_source TEXT CHECK (author_source IN ('finna', 'google_books', 'open_library', 'ai', 'you')),
  publisher TEXT,
  publisher_source TEXT CHECK (publisher_source IN ('finna', 'google_books', 'open_library', 'ai', 'you')),
  year TEXT,
  year_source TEXT CHECK (year_source IN ('finna', 'google_books', 'open_library', 'ai', 'you')),
  description TEXT,
  description_source TEXT CHECK (description_source IN ('ai', 'you')),

  -- Always the person's: never filled in by the app.
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  condition TEXT CHECK (condition IS NULL OR condition IN ('K1', 'K2', 'K3', 'K4', 'K5')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  location TEXT,

  -- R2 keys (bookops/…), or NULL for a book added by ISBN alone.
  front_photo TEXT,
  back_photo TEXT,

  -- The work still to do for this book, and how it went.
  lookup_status TEXT NOT NULL DEFAULT 'none' CHECK (lookup_status IN ('none', 'pending', 'found', 'not_found')),
  lookup_attempts INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none', 'pending', 'done', 'failed')),
  ai_note TEXT,
  -- Set while a request is doing that work, so two don't do it twice.
  work_started_at TEXT,

  -- Once sent to the web store.
  listed_at TEXT,
  listing_ref TEXT
);

CREATE INDEX bookops_books_created ON bookops_books (created_at);
