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
once it returns. Deferred by choice — not part of Phase 2 — but it should be
designed into Phase 3 (scanning) rather than bolted on afterwards.
