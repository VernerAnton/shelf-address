# Multi-shop profiles — saved plan

> **Status: not started. Discuss with the owner before building anything.**
> Saved on 2026-11-23 at the owner's request ("Save that for later, it won't
> properly happen soon"). Nothing in the app has been changed for this.

## The idea

The owner may start part-time at a second used bookstore and would like the
app to work there too, with each shop seeing only its own data.

## What the owner decided

1. **Admin (the owner) sees everything**, every shop.
2. **Staff within a shop are all equal**: no roles for now.
3. **One login page.** Each shop has a 6-digit code that works as username
   and password at the same time.
4. **Each shop is a 1:1 copy of the app** (same features), with its own
   separate data.
5. **No rush.**

## Recommended architecture

**One app, one address; a separate database (D1) and separate storage (R2)
for each shop, chosen at login.**

Why this instead of adding a `shop_id` column everywhere:

- **Isolation by structure.** A forgotten `WHERE shop_id = ?` can't leak
  another shop's books, because the other shop's data is in a different
  database. The 84 SQL queries in 12 `lib/` files stay as they are.
- **No awkward unique keys.** `locations.address` and `address_key` are
  unique across the whole table today; two shops will both have a "A1".
- **No splitting `editions`.** It looks like shared book data, but it holds
  shop-specific things: manual entries, hand-taken covers, `needs_review`.
- **Today's data becomes shop 1** with no migration of rows.
- **Admin:** a longer code (10+ characters) and a shop switcher.
- **Check first:** the Cloudflare plan's limit on the number of D1
  databases.

## What the current app would need

- **Almost nothing is behind a login today.** Only Extract's AI reading and
  Saved texts are. The other 18 pages and most API routes are open,
  including maps, covers and the photo log. A shop login has to cover all of
  them.
- **The phone's own storage is not per shop.** These kv keys would need a
  shop prefix (or clearing on switch): `queue`, `recent`, `places`,
  `activePlaceId`, `review`, `evaluated`, `extract:*`, `photo-log:*`, plus
  the service worker's page cache. **Switching shop must be blocked while
  scans are still waiting to upload**, or they'd go to the wrong shop.

## Work, piece by piece

| Part | Size |
|---|---|
| Whole-app login with guess throttling | Medium |
| Choosing the shop's D1/R2 per request | Small |
| Images and maps behind the login | Small |
| Admin code and shop switcher | Medium |
| Per-shop storage on the phone | Medium (the fiddliest part) |
| Updating the 17 test suites, plus tests that one shop can't see another's data | Medium |
| Per-shop backup and migration scripts | Small |

Overall about the size of Review mode plus Saved texts together. It can go
live in stages, ending with a planned switch-over day when everyone logs in
once.

## Risks

- **A 6-digit code is the weak point.** Throttling helps; 8 digits would be
  safer.
- **The admin's own phone is the special case**: it moves between shops, so
  it's where wrong-shop mistakes would happen.
- **On switch-over day everyone is locked out until they log in.**

## Still to decide

- AI reading costs: one OpenRouter key for all shops, or one per shop?
- Confirm the separate-database-per-shop approach.
- Code length: 6 or 8 digits.

## Not technical

Agree in writing with each shop who owns its data, and what happens to it
if the owner stops working there.
