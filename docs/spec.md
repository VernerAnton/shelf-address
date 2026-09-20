# Shelf-Address — Design Spec

*Consolidated from design conversation, September 2026. Covers the location/shelf model, scanning, and the instructions/addressing system. Marked as DECIDED where the conversation settled something, OPEN where it's still a call to make.*

**Project name:** Shelf-Address. **Stack:** GitHub (source/CI) + Cloudflare only — no Vercel, no Firebase, no Supabase. See §8 for the full reasoning.

---

## 1. Purpose

A personal tool (not for the store owner) to:
1. Scan a book's barcode → get ISBN.
2. Look up title/author/edition/publisher via API (Finna primary, Google Books / Open Library fallback) — no AI needed for this part.
3. Log the physical copy against a specific place in the store or a warehouse.
4. Later, given a title, produce a physical address a human can walk to and find it — including enough local instruction to actually locate it once they're standing at the right shelf, since the internal organization is personal/improvised and doesn't follow a legible external scheme (alphabetical, genre, Dewey, etc.).

This is a different kind of problem than the pricing agent: the pricing agent has to encode fuzzy human judgment, this one is closer to plumbing — scan → lookup → store → retrieve. The hard part here isn't the tech, it's that the physical space itself is improvised, so the tool needs to capture *that* faithfully rather than impose a clean scheme that doesn't match reality.

---

## 2. Data Model

### 2.1 Locations (tree)

Self-referencing tree, unbounded depth. Two node kinds are structurally special; everything else is a plain node with no special behavior.

```sql
locations (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT REFERENCES locations(id),   -- NULL for root (site) nodes
  kind          TEXT NOT NULL,                    -- 'site' | 'shelf' | 'node'
  label         TEXT NOT NULL,
  address       TEXT UNIQUE,                      -- shelf-only, see §4
  instructions  JSON,                              -- shelf-only, see §3
  map_image_id  TEXT,                              -- site-only, see §5
  sort_order    INTEGER
)
```

**DECIDED:**
- `kind` is an explicit tag, not inferred from tree depth. Depth-inference (e.g. "root = site") breaks the moment a standalone shelf doesn't sit under any site, or something gets nested wrong — an explicit tag costs nothing and avoids that whole bug class.
- Three kinds only:
  - `site` — a store or a warehouse. Always root (`parent_id = NULL`). Gets the reference map (§5).
  - `shelf` — a physical shelf/wall unit. Gets an `address` and an `instructions` panel (§3, §4).
  - `node` — everything in between (row, section, sub-section, whatever). No special screen, no fixed count of levels, no fixed depth. Just tree structure.
- No fixed depth anywhere in the tree. 4 levels under a shelf was an early estimate; superseded — some shelves need 1 level, some (warehouses especially, described as "even more improvised" than the store) may need more. **Working expectation is ~6 levels max under a shelf, but this is not enforced by the tool** — there's no cost to allowing more, and forcing a number just produces busywork on the shelves that don't need it.

### 2.2 Editions (ISBN metadata cache)

```sql
editions (
  isbn13      TEXT PRIMARY KEY,
  title       TEXT,
  author      TEXT,
  publisher   TEXT,
  year        INTEGER,
  edition     TEXT,
  categories  TEXT,
  language    TEXT,
  cover_url   TEXT,
  source      TEXT,      -- 'finna' | 'google_books' | 'open_library' | 'manual'
  fetched_at  TIMESTAMP
)
```

Lookup chain: Finna (Finnish-market coverage, incl. Fennica) → Google Books → Open Library → manual entry. Cache every result locally — a second copy of the same title costs no network call, and over time this becomes a local catalogue independent of any API staying free/available.

**DECIDED — cover images:** obtainable from the same lookup chain, no separate image API needed. Open Library has a dedicated Covers API (`covers.openlibrary.org/b/isbn/{ISBN}-{size}.jpg`, no key required — but their docs ask not to crawl/bulk-hit it); Google Books returns a cover URL directly inside the same metadata response (`imageLinks`); Finna records carry an `images` field but coverage is inconsistent, skewing worst on exactly the older/rarer Finnish titles that matter most. Practice: fetch once per ISBN alongside the metadata call, download into R2, store the R2 path in `cover_url` — never hotlink the source on repeat views.

**OPEN:** pre-ISBN-era books (Finland adopted ISBN ~1970s) have no barcode at all — these are disproportionately the scarce/valuable stock. Manual title/author search + "needs review" flag is required; not yet designed.

### 2.3 Copies (individual physical items)

```sql
copies (
  id            TEXT PRIMARY KEY,
  isbn13        TEXT REFERENCES editions(isbn13),
  location_id   TEXT REFERENCES locations(id),   -- always a 'node' or 'shelf', never 'site'
  condition     TEXT,
  price         NUMERIC,
  status        TEXT,      -- in_stock | sold | reserved
  added_at      TIMESTAMP
)
```

**DECIDED:** location granularity stops at whatever node the copy was scanned into — section-level, not exact shelf position. Framing: this is an *index of where to look*, not a live inventory system. Worth being explicit about that distinction with anyone else using the data, since "inventory" implies a precision this can't maintain.

---

## 3. Instructions Panel (shelf-scoped)

**DECIDED:** one panel per `shelf` node — not per plain node, not store-wide. Covers that shelf's entire subtree, however deep it actually goes.

**Structure:**
- Opened via a small pencil icon in the corner of the shelf's view (popup/modal, not a full screen — keeps it off the main scanning UI).
- The popup mirrors the shelf's *actual existing* children (whatever you've already built — "Section 1," "Section 2," "Sub-sec 1," etc., however many there really are). Each gets a colon and a free-text box next to it. No fixed slots, no invented structure — it reflects the real tree, whatever shape that happens to be.
- One larger free-text box at the bottom: **"How to find a book here."** Title + a step-by-step worked example using a real book ("someone wants X — walk to Y, it's on the third row, grouped by Z not by author"). This field is expected to carry more actual navigational value than all the per-node blanks combined — a concrete worked example generalizes better than a category description, same reasoning as why the case log mattered more than the abstract rules in the pricing framework.

**OPEN:** whether the per-node blanks are single-line or can hold longer text; whether past instruction edits are versioned/dated (given the physical layout may change over time and old instructions could go stale silently).

---

## 4. Addressing

**DECIDED (superseding earlier street-grid design):**
- No computed/geometric addressing. A shelf gets a single manual `address` text field, typed in by hand at creation time — plain labels like "Bulevard 3," same as how real street addresses work (a person assigns and remembers them; nobody derives their own house number from geometry).
- **Global uniqueness — no duplicate address anywhere, across every site.** Enforced with a save-time check: if the address already exists, warn which shelf currently holds it before allowing an override.
- Because uniqueness is global, distinguishing sites falls on the naming convention, not the tool — e.g. `"Store Bulevard 1"` vs `"Warehouse A Bulevard 1"`. **The tool enforces uniqueness; it does not invent or enforce a naming convention.** This needs to be decided before real shelves get entered, since renaming later means touching every existing address by hand.
- When a book is located, the shelf's `address` is what gets shown back as the answer to "where is this."

---

## 5. Reference Map

**DECIDED:**
- One per `site`, purely a memory aid — **no relationship to the data model at all.** Not geometrically tied to addresses, not used to compute anything, doesn't get parsed or referenced by the app logic.
- Can be a photo of a hand-drawn paper sketch (upload, zero build effort) or an in-app digital drawing (more effort, not required). Either is fine — this is a UI/effort tradeoff with no functional difference, not a design decision.

---

## 6. Scanning

**DECIDED / already validated in a working demo:**
- `BarcodeDetector` (native browser API) is not viable cross-device — unsupported in Safari/iOS entirely (WebKit's Shape Detection API has been broken behind a dead feature flag since iOS 18), and only partially supported in Chrome (ChromeOS/macOS/Android, not universal desktop). Given the phone actually scanning day-to-day is unpredictable, this rules out relying on it.
- Using `@zxing/library` (`BrowserMultiFormatReader`, decodes off the live camera feed in JS) instead — confirmed working identically on iOS Safari and Android Chrome in a live prototype. Continuous scan mode with debounce on repeat reads, plus a manual ISBN entry fallback for damaged barcodes or pre-ISBN stock.
- EAN-13 digits on a book barcode are the ISBN-13 directly — no conversion step. Watch for the small secondary barcode some books carry (price add-on, not part of the ISBN).

**Constraint to remember:** the working prototype was built as a sandboxed preview page, which cannot call external APIs (Finna/Google Books) — that's a limitation of the preview environment only, not of the real app. The real app (its own backend/API route) has no such restriction.

---

## 7. UI Notes

**DECIDED:**
- Bottom nav: Scan / Sections / Catalog (validated in prototype).
- Mobile-first — this is the real usage pattern (scanning happens phone-in-hand in the store), not just a convenience.

**OPEN / flagged, not yet built:**
- The current tree view fully indents every level (~20px each). That's fine at 2–3 levels but starts crowding the label at depth on a narrow phone screen once real shelves go deeper. Recommended fix: switch to a drill-down/breadcrumb pattern (one level visible at a time, tap in to go deeper) instead of full nested indentation — not yet confirmed or built.
- Whether there's a simple browsable directory/list of shelves (vs. only finding one by search or by drilling the tree) is not committed — it was floated as an option but the conversation resolved only the `address` field itself, not a dedicated directory view.

---

## 8. Stack

**DECIDED — GitHub + Cloudflare only, no other platform:**
- **Source & CI:** GitHub, push-to-deploy.
- **App:** Next.js (App Router), TypeScript, deployed to **Cloudflare Workers** via the OpenNext Cloudflare adapter (`@opennextjs/cloudflare`) — not Vercel. This gives the app native bindings to D1 and R2 directly (`env.DB`, `env.BUCKET`), no HTTP proxy layer, no extra API token to manage.
- **Database:** Cloudflare D1 (SQL/SQLite) — chosen over Firebase Firestore because the schema is inherently relational (tree traversal, joins between editions/copies), and over Supabase because D1's free tier doesn't force-pause after a week of inactivity, which matters for a project that may go quiet for stretches at this early, informal stage.
- **Object storage:** Cloudflare R2 for cover images / reference map photos — S3-compatible, 10GB free, zero egress fees.

**Why not Vercel:** D1 is designed to be queried from inside a Worker via a native binding; from Vercel you'd be hitting Cloudflare's D1 over its HTTP REST API instead (Cloudflare's own docs describe that API as suited to admin/tooling use, not per-request app traffic), plus managing a Cloudflare API token as a Vercel secret. Separately, Vercel's free Hobby tier is restricted to non-commercial personal use by their fair use policy — this is a real tool for an actual bookstore's stock, even at this informal stage, so that restriction is a live consideration, not theoretical. Cloudflare's free plan carries no such restriction.

**Free-tier headroom:** Workers free tier is 100,000 requests/day — far beyond what scanning sessions will generate. D1 free tier: 5GB storage, 100,000 row writes/day. R2 free tier: 10GB storage, zero egress. All comfortably enough at single-bookstore-plus-warehouses scale.

**OPEN:** whether store/warehouse wifi is reliable enough that D1's lack of built-in offline sync is a non-issue, or whether it's worth hand-rolling a local scan queue for connectivity gaps. Not yet confirmed either way.

---

## 9. Summary of Open Decisions

| # | Open item | Notes |
|---|---|---|
| 1 | Pre-ISBN book handling | Manual search + "needs review" flag, not yet designed |
| 2 | Instructions panel: single-line vs. long text per node; versioning of edits | |
| 3 | Site naming convention baked into addresses | Needed before real data entry begins |
| 4 | Map: photo upload vs. in-app drawing | Pure effort tradeoff, no functional difference |
| 5 | Tree UI at depth: drill-down redesign | Recommended, not built |
| 6 | Standalone shelf directory/list view | Floated, not committed |
| 7 | Store/warehouse wifi reliability | Determines whether offline scan queue is worth building |
