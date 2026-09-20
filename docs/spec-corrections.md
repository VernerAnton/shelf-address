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
