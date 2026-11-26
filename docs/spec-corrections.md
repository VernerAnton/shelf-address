# Decisions taken since the spec

`spec.md` is the September 2026 design document. Everything below was settled
afterwards and **overrides it where they conflict**. Newest last.

---

## 1. Addresses carry no site prefix. Uniqueness is on the bare name.

**Overrides:** §4's naming-convention paragraph, and open item #3 in §9.

The spec proposed distinguishing sites inside the address text —
`"Store Bulevard 1"` vs `"Warehouse A Bulevard 1"` — with the tool enforcing
uniqueness on the full string.

That is rejected. There is exactly **one "Bulevard 1" in the entire system**,
across every site and warehouse. Addresses are bare names, each spent once, the
way a city has one Bulevard 1. Site names are not typed into the address field.

Consequences:

- The site is shown by walking up the tree from the shelf, so a located book
  reads `Warehouse A — Bulevard 1` on screen while `Bulevard 1` is what is
  stored. Renaming a site updates every address under it; under the old scheme
  renaming meant hand-editing every shelf.
- Open item #3 ("site naming convention baked into addresses, needed before
  real data entry begins") is dead. There is no convention to decide.
- A shelf with no site above it (§2.1 allows this) simply shows its bare
  address with no prefix.

**Enforcement.** `locations.address` is `UNIQUE COLLATE NOCASE`, so
`"Bulevard 1"` and `"bulevard 1"` collide. Known gap: SQLite's `NOCASE` folds
ASCII only, so `"Ä"` and `"ä"` are *not* treated as equal. If Finnish
characters end up in real addresses this needs application-level
normalisation — no such addresses exist yet, so it is not yet built.

## 2. A duplicate address is reassigned, not duplicated.

**Clarifies:** §4's "warn which shelf currently holds it before allowing an
override", which is not achievable alongside §2.1's `address TEXT UNIQUE` —
the write simply fails.

Resolved as: keep the database constraint. On a collision, warn and name the
shelf that currently holds the address. If confirmed, the address **moves** to
the new shelf and is cleared from the old one. Two shelves never hold the same
address at any point.

(UI behaviour, to be built in Phase 2. The constraint backing it is in
`migrations/0001_init.sql` already.)

## 3. Books are not subject to any uniqueness rule.

**Clarifies:** §2.2 and §2.3, where three different primary keys could read as
"only one of these allowed".

- `locations.address` — the only business uniqueness rule, and the only one
  typed by hand.
- `editions.isbn13` — a *metadata cache* key: the title and author for a given
  ISBN are fetched and stored once. It places no limit on stock.
- `copies.id` — one row per physical book, generated, never typed.

Any number of copies of the same book may be shelved, on the same shelf or
scattered across sites. §2.3's framing holds: this is an index of where to
look, not an inventory count.

## 4. Locator only: no price, no stock status on copies.

**Overrides:** §2.3's `price` and `status` columns.

Shelf-Address answers "where is this copy?" and nothing else. It is not a
pricing tool, so `price` is gone. Whether a copy is in stock, sold or reserved
is the store's own backend's job; keeping a second copy of that here would let
two systems disagree, so `status` is gone too.

`condition` stays: which physical copy sits where can genuinely depend on it —
a torn copy may be shelved apart from a pristine one.

Implemented in `migrations/0002_locator_only.sql`.

## 5. Address uniqueness covers Finnish letters and near-misses.

**Extends:** §1–2 above.

- Uniqueness is enforced on `locations.address_key`: the address with full
  Unicode case folding and whitespace collapsed, computed in `lib/address.ts`
  and guaranteed unique by the database. `"ÄÄKKÖNEN 2"` and `"Ääkkönen 2"`
  collide, closing the gap noted under §1.
- An address that *looks like* an existing one written differently —
  `"Warehouse A Bulevard 1"` vs `"Bulevard 1"`, or `"Bulevard-1"` — gets a
  soft warning that can be overridden. Compared word by word, so
  `"Bulevard 10"` is not flagged against `"Bulevard 1"`.

## 6. Tree UI: drill-down, plus an A–Z address list.

**Resolves:** §7 open items #5 and #6, §9 items 5 and 6.

- The tree is drill-down: one level on screen, tap in to go deeper, a
  breadcrumb trail to come back up. No indentation, so depth never squeezes
  the labels.
- Sections also has an **Addresses A–Z** view: every shelf address across
  all sites, filterable, each opening its shelf.

## 7. Shelves don't nest inside shelves.

**Adds to:** §2.1, which leaves this unstated.

Inside a shelf, only sections can be added. A shelf's instructions panel
(§3) covers its whole subtree; a shelf inside a shelf would make it
ambiguous which panel applies. Enforced by the app; the schema permits it.

## 8. Offline scanning is needed — build it later.

**Resolves:** §8 open item #7 and §9 item 7.

Signal at the warehouse is unreliable, so a local scan queue is worth
building: scans made without a connection are kept on the phone and uploaded
once it returns. Built into Phase 3 — see §10.

## 9. Sections can have an address too.

**Overrides:** §2.1's "address — shelf-only" and §4's framing of addresses as
a shelf-only field.

Sections are often a real spot in the store — a table, a corner — and a book
logged there needs an answer to "where is this?". So:

- **Shelves must have an address; sections may; sites never do.**
- **One pool.** Shelf and section addresses share the same global uniqueness,
  near-miss warning and move-it-here flow (§1–2, §5).
- **Nearest address wins.** A place without its own address is found at the
  nearest addressed place above it — "Row 2" inside shelf Bulevard 1 shows
  "Inside Store — Bulevard 1". That's the answer a book logged there gives.
- Switching a shelf to a section now keeps the address; only the shelf-only
  instructions panel (§3) is dropped.
- The A–Z list includes addressed sections.

Implemented in `migrations/0003_section_addresses.sql`, which rebuilds
`locations` (SQLite can't alter a CHECK constraint) without losing rows.
Whether addressed sections should also get an instructions panel is open —
decide in Phase 5.

## 10. How scanning works (Phase 3).

Decisions taken while building §6; none contradict the spec, but they're
choices a reader of the spec couldn't infer.

- **The active place lives on the phone.** "Scan here" on a shelf or section,
  or the picker on the Scan tab, sets where books are logged until changed.
  Each phone has its own.
- **Offline first.** Every scan is written to the phone (IndexedDB) before any
  upload is tried, then uploaded in order when there's signal — on scan, when
  the connection returns, when the app is reopened, and every 20 seconds.
  The phone makes each copy's id, so a retried upload is stored once. A
  service worker lets the Scan tab open with no signal; the place picker works
  from a copy of the tree saved on the phone.
- **Undo and condition work offline too.** Undoing a scan that hasn't
  uploaded yet just drops it; a condition added before upload travels with it.
- **A scan that can never succeed is parked, not lost** — e.g. its place was
  deleted meanwhile. It can be re-logged at the current place or discarded.
- **Uploads use a JSON API, not Server Actions.** Server Action ids change on
  every deploy, which would strand scans queued before an update.
- **Continuous camera scanning logs a barcode once while it stays in view.**
  Taking the book away and showing it again logs another copy.
- **Only book barcodes are accepted:** EAN-13 with the 978/979 prefix. Other
  barcodes are explained and ignored. Typed ISBN-10s are converted.
- **Condition is optional and added after the scan**, from the recent-scans
  list or the book's own page.
- **A copy points at a placeholder edition** (ISBN only) until Phase 4's
  lookup fills in title, author and cover.

## 11. Condition is a grade, K1–K5.

**Refines:** §2.3's free-text `condition`, and §10's "optional, added after the
scan".

Condition is one of the store's own grades, **K1, K2, K3, K4 or K5**, set with
one tap — on each recent scan and on the book's own page. Tapping the chosen
grade again clears it. The server accepts nothing else, so every copy is graded
the same way. (No free-text conditions existed when this changed.)

Also from the first real-world test: the Scan tab's recent-scans list now
shows only what was scanned into the **current** place, with scans from other
places folded under "Recent scans in other places". Previously one list mixed
every place, which read as if books scanned into Row 1 were in Row 2.

## 12. Book lookup, books without a barcode, and the Catalog (Phase 4).

**Implements** §2.2 and the §1 "retrieve" step; **resolves** §2.2's open
item on pre-ISBN stock (§9 item 1).

- **Lookup chain as specified — Finna → Google Books → Open Library —** run on
  the server after each scan has been saved, so scanning never waits on it and
  an offline scan is looked up once it uploads. Details come from the first
  source that knows the book; the cover from the first source that has one
  (Finna rarely does for older titles), then Open Library's covers-by-ISBN.
- **Covers are downloaded once into R2** and served from there (`/covers/…`),
  never hotlinked (§2.2).
- **Finna's ISBN search is fuzzy** (it returns other books, and some library
  records are miscatalogued), so only records listing the exact ISBN count and
  they vote on the title. Where a record gives no roles, only the first-listed
  person is shown as author, so translators aren't presented as co-authors.
- **Temporary failures are retried** (paused between tries, up to six); only
  when every source actually answered "unknown" is a book marked not found.
  A book page offers "Look up now" / "Try again", and details can be entered
  by hand for a book no source knows.
- **Google Books needs an API key in practice:** without one it shares an
  anonymous daily quota that was exhausted when this was built. The app works
  without it (the chain moves on), and uses `GOOGLE_BOOKS_API_KEY` if set as
  a Worker secret.
- **Books without a barcode:** search Finna by title/author, pick the edition
  (printed books only, one entry per edition). A pick that has an ISBN is
  logged under it, joining any scanned copies. One without is keyed
  `finna:<record id>`. Not listed, or no signal: type title/author/year by
  hand — keyed `manual:<uuid>`, marked **needs review**. `editions.isbn13`
  holds these keys; the column name is kept to avoid rebuilding two tables.
- **Catalog tab:** search by title, author or ISBN (including ISBN-10 as
  printed in older books), Finnish-aware. Each result lists every copy with
  its address — the nearest address above where it was logged — the exact
  place, and condition. A "Needs review" list collects hand-entered books.
- Condition hint: **K1 worst · K5 best.**

Implemented in `migrations/0004_edition_lookup.sql`, `lib/lookup/`,
`lib/editions.ts`, `lib/catalog.ts`.

## 13. Correcting a book whose barcode is wrong.

**Adds to:** §12.

Barcodes are sometimes simply wrong — a new book printed with another
book's ISBN. Such a copy is looked up "successfully" as the wrong book.

- **"Wrong book? Pick the right one"** on a copy with an ISBN re-points that
  copy at the book it really is: by the ISBN printed inside (copyright page),
  by Finna title/author search, or typed by hand (then "needs review"). The
  wrong ISBN's own details are left untouched, because genuine copies of that
  ISBN may exist. Other copies logged with the same barcode can be moved in
  the same step.
- **"Edit details"** is now on every book page, for smaller fixes (a typo, a
  translator shown as author). It changes the details for every copy of that
  edition, and says so.

## 14. Instructions panels and the reference map.

**Adds to:** spec §3 and §5.

- **Who has a panel:** every shelf, and every section that has an address
  (§9) — the places you'd walk to. Sites and unaddressed sections don't.
  A place inside follows the nearest panel above it; an addressed section
  inside a shelf has its own panel, and the shelf's panel stops at it.
- **Stored in its own `panels` table** (`migrations/0005_panels.sql`), not in
  `locations.instructions`: that column's CHECK allows shelves only, and
  widening it would mean rebuilding `locations` again. `locations.instructions`
  stays, unused. A panel whose section later loses its address is kept but
  not shown, so nothing typed is lost; deleting the place deletes its panel.
- **Notes are keyed by place id**, not by label, so renaming or reordering a
  row keeps its note; notes for places no longer inside are dropped on the
  next save. Each note starts as one line and grows with the text.
- **Shown where it helps:** the owner's page shows the panel with a pencil to
  edit; each place inside shows its own note on the way down plus "How to
  find a book here"; list rows carry their note as a subtitle; a book's page
  shows the same guidance under "Where it is".
- **History:** only the "Updated <date>" of the last save — no version log.
- **Reference map:** a photo (of a sketch, a floor plan) uploaded per site.
  The phone shrinks it to at most 2000 px before upload. Stored in R2 under
  `maps/`, replaced or removed from the map page, and deleted with its site.
  Linked from the site, every place inside it, and every book logged there.
  Still tied to nothing else (§5).

## 15. Cover photos taken on the phone.

**Adds to:** §12 (lookups) and spec §2.2 (covers).

When no source has a cover — common for older Finnish titles — the book is
photographed. Searching Google Images was considered and rejected: there's
no legitimate image-search API left to use, results are often another
edition, and the images belong to others.

- **When it's offered:** on a scan's row, once its lookup has come back
  without a cover ("No cover found"), or straight away with no signal. A
  button, never an automatic switch to the camera — that would cut into
  scanning a stack. Also on every book page: "Photograph cover", or "Replace
  cover with a photo" when the found cover is wrong.
- **Per edition:** the photo is shared by every copy of that book, and
  replaces any cover the sources found. `editions.cover_by_hand` marks it;
  a later lookup never replaces it (`migrations/0006_cover_photos.sql`).
- **Like a document scanner:** the camera outlines the book live; after the
  shot, four corner handles start on the book's corners (drag to correct,
  with a magnifier); saving straightens and crops it to at most 1600 px, with
  a mild brightness/contrast lift. "Choose a photo" works the same on a saved
  picture. Edge detection is OpenCV.js (~11 MB), served from this site, run
  in a worker, downloaded in the background while there's signal and kept
  by the service worker for offline use. Detection works in colour, and
  joins a cover that bands or lines split into pieces. It can still be
  fooled — two books side by side, a cover the same colour as the table —
  which is what the handles are for.
- **Offline:** the photo is saved on the phone and uploads after its scan,
  like everything else in the queue.

## 16. Review mode: checking a place against what's on it.

**Adds to:** spec §1 (the app never tracks sales — spec-corrections §4 — so
sold or moved books would otherwise stay logged where they no longer are).

A review is started on one place ("Review books here", or from the Scan tab)
and covers only the books logged at exactly that place. Every book on the
shelf is scanned; the app compares copies logged there with copies scanned,
book by book, as a count:

1. **Logged here, scanned:** ticked off. Never duplicated.
2. **Scanned beyond what's logged here** (a book new to the system, or one
   more copy): added here — unless the book has a copy marked missing from
   another place, when the app asks "Is this the copy missing from Row 3?".
   Yes changes that copy's address to here; no adds a new copy. A place's own
   copies are never asked about, even if the same book is missing elsewhere.
3. **Logged here, not scanned:** listed at the end with where other copies
   are logged (information only), then **Remove (sold)** or **Leave pending**
   (the default). Pending copies are marked missing (`copies.missing_since`),
   listed under Catalog → "Not found in reviews", and badged on their place
   and book pages.

Books without a barcode are ticked by hand. The same "is this the missing
copy?" question is asked in normal scanning too. The principle throughout:
books aren't moved by the app — their address is changed to where they are.

Starting needs signal once (the list of what's logged there, and the missing
list); after that the review works offline, survives the app being closed,
and is saved through the Scan tab's upload queue. Each place shows "Last
reviewed" (`locations.reviewed_at`). Implemented in `migrations/0007_reviews.sql`,
`lib/review.ts` (the rules, unit tested) and `lib/reviews.ts`.

## 17. Evaluate: what a book sells for on Antikvaari.fi.

A fourth tab, **Evaluate**, opens straight to the camera. Scanning (or typing)
an ISBN opens `https://www.antikvaari.fi/hakukone?q=<ISBN-13>` — the search
address Antikvaari publishes itself. Nothing is logged; a short "Recently
evaluated" list is kept on the phone to reopen a search.

Two switches, saved per phone, both on by default because speed is the point:

- **Open Antikvaari straight after a scan.** Off: the book is shown with an
  "Open on Antikvaari" button and "Scan next".
- **Start scanning again when I come back.** Off: the book waits on screen.

With both on, the book is usually still in front of the camera on return,
so the first read of that same book after coming back is ignored (otherwise
it would bounce straight back to Antikvaari); move it away and back to look
it up again. With no signal, it doesn't try to open Antikvaari.

Investigated before building (2026-10-01): Antikvaari sends
`X-Frame-Options: SAMEORIGIN`, so its pages can't be shown inside the app —
a real iframe test was refused — and results are rendered by JavaScript.
robots.txt allows `/hakukone`; the terms (Sopimusehdot) say nothing about
linking, and there's no public API. So it's a plain same-tab link, nothing
fetched, copied or proxied. In the installed app, an outside link opens over
the app (iPhone: Done; Android: ✕) and returns to the same screen.

## 18. Scanning on weaker phone cameras.

**Adds to:** spec §6. Prompted by a Samsung Galaxy A26 that wouldn't read
barcodes: three back lenses (50 MP main, 8 MP ultra-wide, 2 MP fixed-focus
macro), and the browser doesn't always hand over the main one.

- **Main lens chosen on purpose** from the camera labels (Samsung
  "camera2 0, facing back", iPhone "Back Camera"; ultra-wide, macro and
  telephoto last) — `lib/camera-choice.ts`, unit tested. A **Lens 1/3**
  button cycles the back lenses; the choice is remembered on the phone.
- **Continuous autofocus** requested where the camera supports it.
- **Zoom** (1×/2×/3×, where supported): hold the book further away, where a
  cheap camera can focus, and zoom in.
- **"Camera struggling? Take a photo of the barcode"**: the phone's own
  camera app takes the picture (it focuses better than a browser), and the
  barcode is read from the photo at several sizes and both orientations.
- ZXing's **try-harder** mode is used for photos only: in @zxing/library
  0.21 it silently stops the live decoder.

On every scanning screen (Scan, Review, Evaluate).

## 19. Covered barcodes, pocket books, remembered camera settings.

**Adds to:** spec §6 and §17 (`docs/fine-tuning.md` items 1–3).

- **Covered barcodes.** Recycling shops often stick their price over the
  barcode. "Camera struggling? Take a photo" now also accepts a photo of the
  **copyright page** (the back of the title page): if the photo has no
  barcode, the printed ISBN is read from it with Tesseract, on the phone
  (`lib/client/ocr.ts`). Every candidate must pass the ISBN check digit, so a
  misread number is dropped rather than giving the wrong book; common
  look-alikes (O for 0, l for 1…) are corrected inside number runs
  (`lib/isbn-text.ts`, unit tested). Tried upright, then on its sides. A page
  listing several ISBNs (hardback, paperback, e-book) shows them with the
  rest of their line ("(sid.)", "(nid.)") and asks which is the book in hand.
  The files (about 7 MB: engine, worker, English data, which reads digits and
  Finnish imprint lines well enough) are served from `/vendor/tesseract-<v>/`,
  downloaded in the background once a scanning screen has been open a few
  seconds, and kept by the service worker, so it works without signal after
  that. On Data Saver they download on first use instead.
- **Search by title** on Evaluate: whatever is typed goes to Antikvaari's
  search (`hakukone?q=`). Coming back restarts scanning as after a scan.
- **Pocket books:** the camera asks for 1920×1080 instead of 1280×720, for
  more pixels per bar on small barcodes. A best guess, pending a test on a
  real problem book.
- **Zoom and light are remembered** on the phone, like the lens, and come
  back whenever the camera starts — including returning from Antikvaari,
  where the camera has to be released while away.

On every scanning screen (Scan, Review, Evaluate).

## 20. Opens on Evaluate.

**Changes:** spec §7 (the app opened on Scan).

- **The app opens on Evaluate**: the manifest's `start_url` and `/` both go
  to `/evaluate`. A phone keeps the start page the app was installed with
  (`/scan` before V14) until it refreshes the app's details — Android
  eventually, an iPhone never (only by re-adding the icon). So since V16 a
  tiny script at the top of every page sends a **launch** that lands on
  `/scan` on to `/evaluate`: the installed app (display-mode standalone),
  the first page of the session (sessionStorage), a fresh load (not a
  reload). The Scan tab, reloads and browser tabs are untouched.
- *Tried and removed (V14 → V15):* a switch to open Antikvaari in the
  phone's browser instead of over the app. A phone opens the browser only
  on a tap, so scans couldn't open it by themselves; it wasn't worth the
  extra tap.

## 21. Photo log, and a text reader that recovers.

**Adds to:** §19. Prompted by a real phone (Galaxy A26) where reading a
printed ISBN worked a couple of times and then failed ten times in a row.

- **Photo log** (`photo_log` table, migration 0008; photos in R2 under
  `photo-log/`): every photo taken with "Camera struggling? Take a photo" is
  kept with what the app made of it — barcode read, ISBN read, several
  offered, nothing found, error (with its message), or *lost* — plus the
  text the reader saw in each orientation tried, how long it took, the photo's
  size, the screen, the phone's browser and the app version. A thumbnail is
  made on the phone for the list.
- Saved on the phone first, then uploaded in the background
  (`lib/client/photo-log.ts`); without signal it waits and goes up later, at
  most 30 entries kept waiting. Logging never holds up the photo button.
- **Photo log page** (`/photo-log`, linked from Evaluate): the entries with
  thumbnails, a count by outcome, the text read, the full photo, and Delete.
  A per-phone switch turns logging off. Entries older than 30 days are
  deleted, photos included, whenever a new one arrives. `GET /api/photo-log`
  gives the entries as JSON for looking through them elsewhere.
- No login is on, so anyone with the address can see the page; the photos
  are of book pages.
- **The text reader recovers.** It was started once and reused; if it
  crashed (out of memory, say), every later photo failed until the app was
  closed. Now a reading that fails or takes over 60 s throws the reader away
  and tries the photo once more with a fresh one.
- **Less memory per photo:** decoded once (it was twice) for the barcode, the
  text and the thumbnail; working copies are freed straight away.
- **Lost photos:** Android may close the app while its camera app is open,
  and the app reopens without the photo. The app now notices (a marker set
  when the camera opens, still there when the app reloads), says so, and logs
  it as *lost*.

## 22. Extract, and the bottom rows rearranged.

**Changes:** spec §7 (Scan / Sections / Catalog as the three tabs).

- **Extract** (`/extract`): photograph a book's back-cover text and get it to
  the computer — for making a new back cover for a copy that lacks one. The
  phone's own camera app takes the photo; the text is read on the phone
  with Tesseract, Finnish and English data (`fin+eng`, about 4 MB more,
  downloaded once when Extract is first opened; works offline after that).
  Read at up to 2400 px; tried on its sides when the upright read doesn't
  look like real words (`wordLikeness`: Tesseract can be confident about
  text read the wrong way up).
- The text is tidied (`lib/extract-text.ts`, unit tested): lines broken by
  the cover joined into paragraphs, hyphenated words rejoined ("kirjoit-" /
  "taja"), real hyphens kept ("EU-maissa", "Etelä-Suomessa"), specks
  dropped. It's shown in an editable box, kept on the phone as it's edited,
  and a second photo adds to the end.
- **Share** sends it as a `.txt` file named after the first words — OneDrive
  in the share menu puts it on the computer; email and the rest work too.
  Without a share menu (a computer's browser) the file is saved. **Copy**
  copies it. A warning shows when the reader wasn't confident.
- No AI yet: if real back covers come out too badly, a vision model can be
  added as the reading step, the rest unchanged.
- **Bottom rows**: the main row is Sections · Evaluate · Extract. While in
  Sections (places, Scan, Catalog, book pages) a second row sits just above
  it — Places · Scan · Catalog — where the thumb rests. The page keeps its
  end clear of whichever rows show. The Photo log counts as Evaluate.
- **Tests now live in the repository** (`e2e/`, run with `e2e/run.sh`). The
  earlier suites lived in a session's scratch folder and were lost when the
  cloud environment was reset; the launch and photo-log suites were
  recovered, and new ones cover Extract and the bottom rows.

## 23. Extract reads with AI, behind an access code.

**Adds to:** §22. The on-phone reader couldn't cope with designed back covers
(decorative fonts, coloured backgrounds, text over pictures).

- **AI reading by default.** The photo (made smaller on the phone: 2000 px,
  JPEG) goes to the app's server (`/api/extract`), which asks a vision model
  on OpenRouter to transcribe it — `google/gemini-3.8-flash`, chosen on price
  per photo; `EXTRACT_MODEL` can name another. The instructions
  (`lib/extract-ai.ts`): copy exactly, keep ä/ö/å, join lines into
  paragraphs, leave out price stickers, barcodes, ISBNs and logos, write [?]
  for what can't be read, add nothing. Temperature 0.
- **Only Extract's AI needs a login** — the rest of the app stays open. One
  shared access code (`EXTRACT_CODE`, a Worker secret), asked once per
  phone. The login is an HttpOnly, SameSite=Strict cookie for `/api/extract`
  only, derived from the code (an HMAC), so it never holds the code and
  changing the code logs every phone out. Browsers keep cookies 400 days at
  most; each visit to Extract renews it. After 10 wrong codes in an hour from
  one address, tries are refused (`extract_login_failures`, migration 0009).
- **Spending** is capped on OpenRouter (a weekly limit on the key), not in
  the app. The key (`OPENROUTER_API_KEY`) is a Worker secret, never on the
  phone.
- **The phone reader stays as the backup.** Not logged in, no signal, the
  limit used up, the key not working, or the AI failing or taking over 60 s:
  the phone reads it instead, and says why. Until the code and key are set,
  Extract just uses the phone reader.

## 24. Saved texts: Extract's texts on the computer, no sharing step.

**Adds to:** §22, §23. Sharing to OneDrive took too many taps.

- On a phone logged in to AI reading, every text Extract reads is saved to
  the server by itself (`saved_texts`, migration 0010), and so is every
  correction (a second after typing pauses, or straight away when the app
  is left). "Start over" begins a new text; the old one stays saved. Without
  signal the latest version waits on the phone (`lib/client/saved-texts.ts`)
  and goes up when signal returns; an older version arriving late never
  overwrites a newer one. Phones not logged in save nothing (Share and Copy
  are still there).
- **Saved texts page** (`/extract/saved`, linked from Extract): behind the
  same access code (the computer's browser logs in once). Newest first, each
  marked AI or "read by phone — check"; the selected text with **Copy**,
  **Download .txt**, **Mark done** (greyed in the list) and **Delete**.
  Refreshes every 5 s while on screen, so a text read on a phone appears
  within seconds. On a big screen the list and the text sit side by side; on
  a phone, the list, and a tap opens one.
- Texts are deleted 7 days after their last change (30 until V27).

## 25. A computer opens on Saved texts.

**Changes:** §20 (the app opens on Evaluate).

- Nobody photographs books with a computer; it's where Extract's texts are
  picked up. So on a computer the app's address (`/`) and the Extract tab
  (`/extract`) go straight to Saved texts. Phones are unchanged: `/` opens
  Evaluate, Extract is the camera.
- Phone or computer is told from the browser's User-Agent (`lib/device.ts`:
  "Mobi", Android, iPhone, iPod → phone). An iPad reports itself as a Mac and
  counts as a computer.
- An app installed on a computer (a Chromebook) opens on its saved start page
  (`/evaluate`); the launch check in `app/layout.tsx` sends a computer's
  launch on to Saved texts, as it sends a phone's old `/scan` launch to
  Evaluate.

## 26. Saved texts can be corrected on the computer.

**Adds to:** §24. Correcting on a computer is much easier than on a phone.

- On Saved texts the text is an editable box; corrections save by
  themselves (0.8 s after typing pauses, or when the box is left), and Copy
  and Download give the corrected text. The list's self-refresh never
  overwrites what's being typed.
- Once a text is corrected on the computer, the computer's version wins:
  the phone's later saves of it are refused (`edited_on_computer_at`,
  migration 0011), and the phone says "corrected on the computer, so changes
  here aren't saved". A text can't be emptied here — Delete is for that.

## 27. Extract: Start over at the top; cut-off readings caught and reportable.

**Adds to:** §23, §21. A clear back cover came back from the AI cut off
part-way, with no sign anything was wrong.

- The AI's answer was capped at 2,000 tokens. The model's thinking counts
  against that cap too, and Finnish takes many tokens per word, so a long
  cover could run out of room. The cap is now 20,000 (cheap at Gemini Flash
  prices).
- The server now passes on why the model stopped (`finish_reason`), its
  token counts and how long it took. If it stopped for lack of room
  (`length`), the phone says "The AI stopped early — the end of the text may
  be missing. Take another photo of the rest."
- **Start over** sits at the top, right under "Add another photo" (only once
  there's text); the one at the bottom is gone.
- **Report a problem:** the phone keeps the last photo (as sent to the AI)
  and exactly what came back, until Start over, even if the app is closed.
  "Text wrong or cut off? Report the last photo" sends them, with an
  optional note, to the Photo log (§21) — even where the log is switched off
  on that phone, since it's a choice. In the log it shows as "Extract:
  reported problem", with the note, the photo, why the AI stopped, the
  tokens used and the reply. Reports use the existing table (outcome
  `error`, screen `/extract`): no database change.

## 28. Extract reworked: red Report, Start over to the camera, front cover to the computer.

**Adds to:** §22–§27. Asked for by the shop owner after using it daily.

**Phone (Extract):**
- **Share and Copy are gone** (Saved texts does that job), with the OneDrive
  line under them. In their place a **big red "Report a problem"** button
  (the §27 report: last photo, what came back, the text now, optional note).
- **Start over** asks nothing and opens the camera straight away for the next
  book. Nothing is lost: the text is in Saved texts (logged-in phones) and
  on the phone itself (below).
- **"Take a photo of the front cover"** appears once the back text is read
  (logged-in phones only: it's for the computer). Made 1600 px on its long
  side and sent with that text; without signal it waits, after the text. A
  line confirms "✓ Front cover saved for the computer". No preview or retake
  button — the phone's camera already offers a retake; taking it again
  replaces it.
- **Earlier texts on this phone:** every text the phone read is kept on the
  phone for 7 days (kv `extract:history`), so Start over never loses one —
  also on a phone that isn't logged in. Tap one to open it again.

**Computer (Saved texts):**
- The front cover shows **large beside the text**, as tall as the text box,
  the whole picture (not cropped); click for full size (Esc closes).
  **Copy picture** (as PNG, to paste with Ctrl+V into a listing) and
  **Download picture** under it; the picture can also be dragged. A small
  one in the list tells the books apart.
- **Copy** (the text) stays; **Download .txt is gone**.
- **Report a problem** (red), as on the phone.

**Server:**
- The AI reading takes the text's id (`X-Text-Id`) and keeps the back-cover
  photo and the AI's exact answer with it (`saved_text_readings`, R2
  `saved-texts/<id>/`), so reports from the computer have the photo. Readings
  whose text never arrived go after a day.
- Front cover: `PUT/GET /api/extract/texts/<id>/cover`, R2
  `saved-texts/<id>/cover-<time>.jpg`, `saved_texts.cover_key/cover_at`.
- Report from the computer: `POST /api/extract/texts/<id>/report {note}` —
  one Photo log entry per back photo (screen `/extract/saved`).
- Photos and readings are deleted with their text (7 days, or Delete).
- Migration 0012.
- **V29:** on a big screen (≥ 1280 px) showing a front cover, the page grows
  to 96rem instead of staying 64rem wide, so the text box gets room and its
  buttons fit on one row. From 1280 px Copy picture and Download picture sit
  beside the cover, so the cover can be as tall as the whole text column
  (from 1536 px; a little shorter below that, so nothing wraps or scrolls).
- **V30:** the front cover can be photographed while the AI is still reading
  the back, so the wait isn't wasted. It's kept on the phone ("✓ Front cover
  taken — it goes to the computer with the text.") and goes up as soon as the
  text is saved. A cover whose text never arrives (the reading failed, then
  Start over) is let go after an hour and never holds up the others.
- **V31:** an AI answer lost on its way back no longer leaves the phone on
  "Reading the text…" for good. It happened in the shop: the front cover was
  taken while the AI read (V30), the browser put the page to sleep with the
  camera open, and the reply (ready on the server in 23 s) never reached it.
  Each reading now has an id the phone gives it (`X-Reading-Id`); the server
  keeps the answer under it, and after 5 s — every 3 s after that, and on
  coming back to the app — the phone also asks `GET /api/extract/readings/<id>`.
  Whichever answer comes first is used; after 90 s it gives up as before.
  On the computer, Report a problem is on two lines and Copy keeps its width
  when it says "Copied ✓", so the buttons stay on one row; on a wide but not
  very wide screen the cover is held to what the text column can spare.

## 29. Faster AI reading: little thinking, the fastest provider.

**Adds to:** §23. The shop asked whether the reading could be faster.

- The readings kept since §28 showed where the time went: 70–80% of what
  Gemini 3.8 Flash produced was hidden "thinking" before the text (e.g. 918
  of 1,172 answer tokens), and copying text from a photo needs little. The
  request now asks for `reasoning: { effort: "minimal" }` (Gemini 3's lowest
  thinking level). Set `EXTRACT_THINKING` (none / minimal / low / medium /
  high) in Cloudflare to change it without a release.
- Two readings took 23–25 s with the same token counts as 8 s ones: a slow
  provider at that moment. The request asks OpenRouter for the provider
  answering fastest right now (`provider: { sort: "latency" }`).
- Each reading records who served it and the thinking level (shown in
  reports: "AI took: 6.1 s, served by …, thinking: minimal").
- If OpenRouter refuses these settings for the model (400), the server asks
  once more without them, as before V32 — the reading never fails over them.
## 30. BookOps: photograph a book, price it while it's filled in.

**Adds to:** §22 (the bottom rows), §23 (AI reading), §24 (the access code).
First version, to try the way of working before any equipment is bought.

- **Where:** the Extract tab has its own row above the main tabs, like
  Sections has: **BookOps** on the left, **Text Extract** on the right.
  Tapping the Extract tab opens Text Extract exactly as before (the camera on
  a phone, Saved texts on a computer; a computer still opens on Saved texts,
  §25). Saved texts counts as Text Extract. Nothing else in the app changed.
- **BookOps on a computer** (`/extract/bookops`), one screen: the queue on the
  left, the book in the middle, the camera on the right.
  - **Camera:** the computer's camera (a webcam on a stand, later; a laptop's
    own, for now), started when the screen opens, at the largest size it
    gives. Two pictures per book: front cover, then back. **Space** takes the
    picture, unless something is being typed. After the back cover the camera
    is ready for the next book at once — it never waits for the reading. A
    camera picker shows when there are several; "Use photo files" takes the
    pictures from files instead.
  - **Book-shaped view** (V29): the camera's picture is shown upright, 3:4,
    cut from the middle of a wide webcam picture, and **what's shown is
    exactly what's saved** (`lib/client/bookops.ts`, `viewRect`). Zoom
    (1×–3×, digital: fewer of the camera's pixels), **Turn** (for a webcam
    mounted on its side, which makes an upright picture use the camera's
    full width — much sharper) and **Whole picture** (not cut, for unusual
    shapes); remembered on that computer.
  - **Focus** (V30): a webcam's autofocus hunts on every new book; on a
    stand the book is always the same distance away. When the camera lets
    the browser set its focus (Chrome, and a webcam whose driver offers it —
    read from the camera, never assumed), **Auto | Fixed** is offered: Fixed
    keeps the focus where autofocus landed, with a Near–Far slider, and is
    remembered for that camera by its name (`lib/client/camera-focus.ts`).
    A camera that doesn't offer it says so, and points to its own settings
    app, which can often turn autofocus off.
  - **Not live all the time** (V27): "Stop camera" turns the camera off (its
    light goes out) and it stays off — also the next time BookOps is opened
    in that browser — until "Start camera". It also stops by itself after
    10 minutes without a picture. A front cover already taken is kept.
  - **ISBN:** from the barcode in the back photo, read in the browser
    (`@zxing/library`, as the scanner does for photos). No barcode: the AI
    reads the printed ISBN, and it's used only if its check digit is right
    (`lib/isbn-text.ts`) — a misread number is dropped, never guessed. It can
    also be typed on the book. The ISBN box at the top adds a book by ISBN
    alone (typed, or a hand-held reader).
  - **Title, author, publisher, year:** from the book databases by ISBN
    (Finna → Google Books → Open Library, the same chain as the catalog's,
    without touching the catalog). Only if there's no ISBN, or no database
    knows it, are title and author the AI's reading of the cover — marked
    "AI read it · check".
  - **Description:** the back-cover text, transcribed by the AI (the same
    model, key and spending cap as Extract; `lib/bookops-ai.ts` asks for the
    text, the ISBN, the title and the author in one go, both photos).
  - **Every field says where its text came from** (Finna, AI, Yours), and
    fills itself in only while nobody has typed in it: what the person typed
    is never overwritten, the AI's reading gives way to a database, a
    database's answer stays (`mayFill`, `lib/bookops-model.ts`).
  - **Price and condition are the person's.** No price is suggested. Four
    plain links open, each in its own tab, the search of Antikvaari.fi (used:
    what others ask), Adlibris, Suomalainen and Akateeminen (new: price and
    whether it's in stock), with the ISBN filled in — or title and author for
    a book without one (`lib/price-sites.ts`). Condition is K1–K5, one click.
    Copies and location are typed (location is free text for now, not the
    places tree).
  - Everything saves by itself. The list refreshes every 3 s, so a field
    filled in, or a book sent from a phone, appears without reloading — and
    never moves what's being typed.
- **Send to web store** needs a title, a price and a condition, and lists the
  book exactly as it stands; it then moves to Listed, locked, and "Take back
  to change it" makes it a draft again. **The connection is a stand-in for
  now** (`lib/bookops-store.ts`): it behaves like a real one — takes a
  moment, answers with a reference — but nothing leaves the app, and the
  screen says "test connection". The real connection replaces those two
  functions; nothing else changes.
- **BookOps on a phone** (V28): the phone is the hand-held ISBN scanner —
  it does what the computer can't. The live barcode scanner (the same one as
  Scan and Evaluate) opens at once; each barcode is a new book in the
  computer's To do list, and its title arrives from the book databases
  within seconds, on the phone's "Sent to the computer" list and on the
  computer (which refreshes by itself). A book already in the queue is still
  added — it may be a second copy — and the phone says "Already in the queue
  — added another copy". **No barcode?** "Photograph the back cover": the
  photo is the book — the AI reads the printed ISBN (check digit checked),
  the databases give the title, and the photo is kept as its back cover, so
  it isn't taken again on the computer. A hand-held reader later types into
  the computer's ISBN box instead; nothing else changes.
- **Photos on the phone** (V31) — the way photos are meant to be taken now;
  phones have better cameras and focus than webcams. Under the scanner,
  **Needs photos** lists every listing still to do that lacks its front or
  back photo (scanned on the phone, typed on the computer, or from a
  hand-held reader); right after a scan the listing also offers **Add photos
  now**. Tapping one opens the phone's own camera app for the back cover
  (where the barcode is, so it's already facing up), then the front (only
  the sides it lacks; back first everywhere since V32, the computer's camera
  too); both go to that listing together,
  and the AI reads the back-cover text — while the price and the rest are
  set on the computer. The scanner pauses while photos are taken, and for
  15 s after they're sent it ignores that book's barcode, so the book still
  in hand isn't added again.
- **BookOps' own camera on the phone** (V32.2): instead of handing off to
  the phone's camera app, photos are taken full screen inside the app
  (`phone-camera.tsx`), with the step over the picture — "1 of 2 · Back
  cover · The side with the barcode", then by itself "2 of 2 · Turn the book
  over: front cover" — one big shutter, Retake, the light where the phone
  has one, and Cancel. The photo is a full-size still where the browser can
  take one (ImageCapture), else the live picture. After the last side the
  camera closes and the photos are sent. "Use the phone's camera app
  instead" is one tap away, for that step. The same camera takes a no-barcode
  back cover.
- **The frame is what's saved** (V32.4): the photo is cut to the dotted
  frame (`frameInPhoto`, `lib/client/bookops.ts`), mapping it through the
  live picture's object-fit and, where the still photo is another shape
  (4:3 photo, 16:9 live picture), through the live picture's place in the
  middle of it. Outside the frame is dimmed. A camera-app photo isn't cut.
  **The scanner's controls** — light, zoom, lens — are on BookOps' camera
  too, remembered on the phone apart from the scanner's (starting from the
  scanner's lens).
- **The computer's camera is off by default** (V31): the camera column is
  replaced by a note on where the photos come from, and "Use the computer's
  camera" brings it back (remembered on that computer). Each listing shows
  its two photo slots, "Waiting for the photo from the phone" until they
  arrive.
- **Photos for a book already in the queue** (V28): when the open book lacks
  photos (scanned, or only its back photographed on a phone), the camera
  says "Photos for: <title>" and takes only the sides it lacks; they're added
  to that book and the AI reads it again (filling in only what's still
  empty). "New book instead" makes the camera start a new book. When the
  open book has its photos, or nothing is open, two pictures make a new book
  as before.
- **Same ISBN** (V28): books still to do that share an ISBN are tagged "Same
  ISBN · n in queue"; the open one says "Another copy of this book is in the
  queue", with a button to open the other — to keep it as a second copy, or
  Delete a double scan.
- **Behind the access code**, like Saved texts — the pages, the photos and
  the API (`/api/extract/bookops/…`, so the existing login cookie covers it).
- **Stored apart from the catalog:** its own table (`bookops_books`,
  migration 0012) and its own photos in R2 (`bookops/…`); the catalog's
  editions, copies and places aren't read or written. Books stay until
  deleted (Delete removes the photos too).
- **The filling-in** (`processBook`, `lib/bookops.ts`) runs after the book is
  stored: the lookup and the AI side by side, then the lookup again if the
  AI is what found the ISBN. Whichever screen added the book starts it; any
  BookOps screen that sees a book still waiting gives it another push every
  20 s, and a claim in the database keeps that to one at a time. A reading
  that failed (no signal to the AI, the spending limit) says why, with "try
  again".
- **Not yet:** cropping and straightening the front photo (waits for the
  stand, where the book's place is fixed); a live "barcode visible" sign;
  the real web store connection.

## 31. Two lines of work joined (V33).

BookOps (§30) was built in another session from 16 to 18 November and went
live then (migration `0012_bookops`); this line of work (§27–§29) had started
from the 3 November version without it, so its releases from 23 November
(V26–V32) took BookOps off the live app. Its data stayed in the database.
V33 joins both: BookOps is back, with Extract as reworked here. The two lines
had both used the version numbers V26–V32; V33 is above both. Both 0012
migrations are applied and don't touch the same tables.
**Only one session at a time should put the app live** (see CLAUDE.md).

## 32. Timers, and a small picture editor (V33.1).

- **Phone:** while the AI reads, the seconds count up beside "The AI is
  reading it"; afterwards the line says "Read by AI in 6.2 s" — the whole
  wait, photo to text.
- **Computer:** the line above the text says "read by AI in 4.9 s" — the AI's
  own time, one per photo of the back ("4.9 s + 6.1 s"), from the kept
  readings (§28).
- **Picture editor** under Copy picture / Download picture: ↺ and ↻ turn the
  front cover a quarter either way; **Crop** — drag across the picture, then
  Save crop or Cancel; **Undo last change** puts back the picture as it was
  before the last turn or crop (one step). Edits are saved to the picture on
  the server (JPEG, quality 0.92), so Copy, Download and the thumbnail show
  the edited one, on every computer.

## 33. Front cover editing: instant turns, the Sections editor (V33.2).

**Replaces** §32's picture editor; asked for by the owner ("feels clumsy";
"the Sections cover editor feels more sophisticated").

- **↺ / ↻ turn at once.** The turned picture is made on the computer and
  shown straight away; it's saved in the background, one save after another
  so quick taps land in order. A short "Saving…" then "✓ Saved" says when it's
  kept; if a save fails, the picture goes back to the server's and says so.
- **Edit picture** opens the same full-screen editor as photographing a
  cover in Sections (§15; `CornerEditor` in components/cover-camera.tsx, now
  shared): four corner handles that start on the book's edges if it finds
  them (OpenCV, as there), a magnifier under the one being dragged, and
  saving straightens and crops to them. Added here: ↺ Left / Right ↻ (shown
  at once) and Whole picture (corners back to the edges). Nothing is saved
  until Save picture; Cancel, Close or Esc leave it as it was. The picture
  keeps its full resolution.
- **Undo last change** puts back the picture as it was before the last turn
  or edit (one step). Copy picture, Download picture and the full-size view
  show the newest picture at once.
- **V33.3:** the corner magnifier goes below the finger when there's no room
  above it (the top corners), and stays inside the picture sideways — in
  Sections' cover camera too, as it's the same editor. Corner handles on the
  picture's very edge show whole (the editor leaves room around the picture),
  so they're easy to grab. Quick taps on ↺ / ↻ all count now: each turn waits
  for the one before and starts from the newest picture (before, two quick
  taps could both start from the same picture, losing a turn).

## 34. Choosing the AI model on the phone (V33.4).

To compare models on real covers (the owner found Grok 4.20 on OpenRouter:
$1.25/$2.50 per million tokens, ~0.55–0.66 s to the first word, ~85–98
tokens/s, against Gemini 3.8 Flash at $0.75/$3.75).

- Under Report a problem, a small **AI model** dropdown: Gemini 3.8 Flash
  (default) or Grok 4.20. Kept per phone (localStorage `extract:model`).
- The phone sends its choice as `X-Model`; the server uses it only if it's on
  the list in `lib/ai-models.ts`, so nothing else can be chosen to spend on.
  The speed settings (§29) go with it; if a model refuses them, the plain
  retry applies.
- The phone's line says "Read by AI (Grok 4.20) in 4.9 s"; the computer's
  "read by AI (Grok 4.20) in 4.1 s"; reports name the model, as before.
- **V33.5:** Grok 4.20 was tried in the shop and was about half as fast as
  Gemini; it's off the list. The default is now `google/gemini-3.8-flash:nitro`
  — OpenRouter picks the fastest endpoints, Google's priority tier included
  (dearer, still well under a cent a cover); with it no `provider.sort` of our
  own is sent. "Gemini 3.8 Flash · standard" stays in the dropdown to compare.
  Each reading records the model as asked for (`requested`), since OpenRouter
  names the same model for both. BookOps reads with the same default.
- **V33.6:** thinking **off** (`effort: "none"`). The shop noticed the same
  book read twice in a row took 13.5 s and then 6.4 s: "minimal" still lets
  Gemini think when it judges a photo hard (1,568 thinking tokens there). The
  thinking reading was also *less* accurate: it wrote "Viestin sisältävän"
  where the cover prints "Viestiin sisältyvän" (the reading without thinking
  had it exactly). If a model refuses "none", it's asked with "minimal", then
  with no settings. No change to the instructions: the owner wants the AI just
  to copy; leftovers like a series number are rare and removed by hand.
- **V33.7:** V33.6's "none" didn't take: OpenRouter's model list (GET
  /api/v1/models) says Gemini 3.8 Flash's thinking is **mandatory**, with only
  high / medium / low accepted — "none" was refused, the step-down sent
  "minimal" (not on its list either, so in effect "low"), and a book still took
  15 s with 927 thinking tokens. Now each model is asked for the least it
  accepts (`lib/ai-models.ts`), with no refused first try: 3.8 Flash "low".
  Two models added to the phone's dropdown to compare on real books: Gemini
  3.1 Flash-Lite with thinking **off** (a third of the price), and Gemini 3.6
  Flash with "minimal". The default stays 3.8 Flash · Nitro until compared.
  `EXTRACT_THINKING` still overrides, for every model.
- **V33.8:** Flash-Lite and 3.6 Flash stopped part-way with an error on one
  book (*Sijoita asuntoihin!*) — 5 times out of 5, always at the same place
  (~770 characters) — while 3.8 Flash read it in full and both read another
  book in full. Not tokens (the other book's answer was three times longer);
  most likely Google's recitation check on a blurb that's online word for
  word. The app had shown the cut-off text without a word. Now: a reading that
  stops with an error (`finish_reason: "error"`) is read again once with the
  default model, and the phone says "Flash-Lite stopped part-way with an
  error, so Gemini 3.8 Flash read it instead"; if the default stops too, the
  "end may be missing" warning shows. Each reading keeps the model's own stop
  reason (`native_finish_reason`) and error message, and reports show them.
- **V33.9 (the owner's choice after comparing in the shop):** Gemini 3.1
  Flash-Lite, thinking off, is the default: about 4–6 s, as accurate as 3.8
  Flash on the books compared, a third of the price. If it stops part-way
  (one book did, every time), the server reads it again with 3.8 Flash · Nitro
  (`FALLBACK_MODEL`), which read that book in full; the phone says so. BookOps
  stays on 3.8 Flash · Nitro: Flash-Lite wasn't tried on its photos.
- **V33.10:** on the computer the text box is as tall as the To do list
  beside it (it ended 5rem short — cramped on a wide, not-so-tall screen).
  The correction status ("Corrections save by themselves" / "Saving…" /
  "✓ Correction saved") moved from its own line into the button row to make
  room; with that, list and text box are 1.5rem shorter than the list was, and
  the page still doesn't scroll (checked at 2560×1000, 1920×1000, 1536×730,
  1366×768).

## 35. ISBN on the phone, copied on the computer (V34).

The owner's idea: some books have no barcode, and the ISBN is needed in the
listing.

- **Phone:** "Add another photo" (nobody used it) is replaced by a **green ISBN
  button** with an **ISBN field** beside it, clearly apart from the back-cover
  text. The green is the accent blue's strength and lightness in green's hue
  (`--isbn`). Tapping ISBN opens the camera; the number appears in the field:
  from the **barcode**, read on the phone (exact, instant), or else a
  **printed ISBN**, read by the AI on its own (`POST /api/extract/isbn`:
  Flash-Lite, no thinking, digits only) — checked with the ISBN check digit
  either way. The field can be typed in or corrected; it's saved once it's a
  valid ISBN. The **back-cover photo** is searched for an ISBN too, alongside
  the reading (no extra wait, and the text's instructions are unchanged), if
  the field is still empty.
- The ISBN is saved with the text (`saved_texts.isbn`, `isbn_source` —
  migration 0013), also on its own if there's no text yet, and also after the
  text was corrected on the computer. Earlier texts on the phone keep theirs.
- **Computer:** "Mark done" (nobody used it) is replaced by a **green ISBN
  button** showing the number; a click copies it. "No ISBN" when there's none.
- **V34.1:** the ISBN button (a 13-digit number) is wider than Mark done
  was, so the button row wrapped on some screens. The correction status moved
  into the text box's bottom corner (no line of its own), the ISBN number is a
  size smaller, and beside a cover the text column gets 2rem more (the
  cover's width budget is 68rem, was 66rem).
- **V34.2:** Download picture opens the "Save as" window (Edge and Chrome:
  `showSaveFilePicker`), so the picture goes straight into the folder kept for
  covers; the browser opens that folder again next time (`id: "front-covers"`).
  Browsers without it download as before.
- **V34.3:** no words inside the text box: a turning ↻ while a correction
  saves and ✓ once saved, just under the box's bottom-right corner, outside
  it (words for screen readers, and for errors).
- **V34.4:** the line above the text shows just the times ("26.11. klo 08.58 ·
  changed 26.11. klo 09.17"); who read it, how long it took, corrections and
  the front cover are in its hover text — it had wrapped onto two lines and
  pushed the text box down. A text read by the phone's own reader still says
  so in red ("check it"). The save icons explain themselves on hover too.

## 36. A second ISBN (V34.5).

Some books print two ISBNs (one per binding, say); only the first was kept.

- The ISBN reading (§35) asks for every ISBN on the photo, one per line;
  `isbnsInAnswer` (lib/isbn.ts) checks each, makes it ISBN-13 and keeps a
  book number once — an old book's 10- and 13-digit forms of one ISBN count
  once — at most two. The phone's barcode reader and the AI now run at the
  same time: a barcode still shows at once, a second ISBN from the AI follows.
- **Phone:** the second appears in its own field on the Extract title's line
  (the heading moved into ExtractScreen for that); it can be corrected or
  emptied (it goes). Emptying the first moves the second up.
- **Computer:** with two, the ISBN button's space holds two half-height green
  buttons, the second just below the first; nothing else moves. Each copies
  its own number.
- `saved_texts.isbn2` (migration 0014); only kept alongside a first, and
  never the same number as the first.
