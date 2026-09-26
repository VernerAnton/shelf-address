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
