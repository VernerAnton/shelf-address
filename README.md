# Shelf-Address

Scan a book's barcode, look up its metadata, log where the physical copy lives
in a location tree, and later get a plain-text address to walk to it.

Personal cataloguing tool for a used bookstore and its warehouses. Full design
spec in [`docs/spec.md`](docs/spec.md); decisions taken since the spec was
written are in [`docs/spec-corrections.md`](docs/spec-corrections.md) and
override it where they conflict.

**Status: Phase 4 (lookup and catalog) complete.** Live at
<https://shelf-address.verner-sdr.workers.dev>. Places can be built, moved
and reordered; books are scanned (or typed, or found by title when they have
no barcode) and logged where you stand, with or without signal; titles,
authors and covers are looked up from Finna, Google Books and Open Library;
the Catalog tab finds any book and says where every copy is. Next: Phase 5,
the per-shelf instructions panel and the site reference map.

## Stack

| Piece | Choice |
| --- | --- |
| App | Next.js 16 (App Router) + TypeScript |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` |
| Database | Cloudflare D1, native binding (`env.DB`) |
| Object storage | Cloudflare R2, native binding (`env.BUCKET`) |
| Styling | Tailwind CSS v4 |

Spec §8 fixes this stack. Notably **not** Vercel: D1 is meant to be queried
from inside a Worker over a binding, not over its HTTP admin API.

## Connecting your Cloudflare account

The code is complete but points at a database that does not exist yet. These
steps create it. You only do this once, and you need to be logged into the
Cloudflare account that will own the project.

**1. Log in.** Opens a browser window; approve the access it asks for.

```bash
npx wrangler login
```

**2. Create the database.** This prints a block of configuration containing a
`database_id` — a long string of letters and numbers.

```bash
npx wrangler d1 create shelf-address-db
```

Copy that `database_id` into `wrangler.jsonc`. (Already done for the
production database — only needed if you ever recreate it.)

**3. Create the image bucket.**

```bash
npx wrangler r2 bucket create shelf-address-media
```

**4. Create the tables** in the real database (step 2 made an empty one):

```bash
npm run db:migrate:remote
```

**5. Deploy.** Prints the live `https://shelf-address.<your-subdomain>.workers.dev`
URL at the end.

```bash
npm run deploy
```

Open that URL. Both rows on the page should be green. A red **D1** row almost
always means step 4 was skipped.

### Restricting who can open the app (Cloudflare Access)

The app has no login of its own. Cloudflare Access sits in front of it and
asks for a one-time code sent to an approved email address before anything
loads. Free for up to 50 people, and no code changes.

**First time only — switch on Zero Trust:** in the Cloudflare dashboard open
**Zero Trust**, pick a team name (anything; it becomes
`<name>.cloudflareaccess.com`), and choose the **Free** plan.

**Then protect the app:**

1. **Workers & Pages** → **shelf-address** → **Access** tab.
2. **Protect this Worker behind Access**.
3. Choose **All traffic** (not "Previews only").
4. Under **Authentication policy**, choose email addresses and enter each
   address allowed in.
5. **Apply Access**.

To add or remove someone later, edit that policy's email list. Per-version
preview URLs are switched off in `wrangler.jsonc`, so the `workers.dev`
address is the only way in.

### Putting it on a phone's home screen

The app is installable (a web app manifest plus icons), so it opens
full-screen with its own icon, no browser bars.

- **iPhone:** open the URL in **Safari** → **Share** → **Add to Home Screen**.
- **Android:** open it in **Chrome** → **⋮** menu → **Install app** (or
  **Add to Home screen**).

The Scan tab works with no signal: scans are kept on the phone and upload by
themselves when the connection returns (docs/spec-corrections.md §10). Other
screens need a connection. The camera needs HTTPS, which workers.dev provides.

With Cloudflare Access on, the login lasts for the Access *session duration*
(default 24 hours) before a new email code is needed. Lengthen it in Zero
Trust → Access → Applications → the app → session duration.

### Optional: a Google Books API key

Lookups try Finna, then Google Books, then Open Library. Without a key,
Google Books usually refuses (its shared free quota is used up), and lookups
simply move on to Open Library. A free key makes Google a real second source:

1. In the Google Cloud console, create a project, enable the **Books API**, and
   create an **API key** (restrict it to the Books API).
2. In Cloudflare: **Workers & Pages** → **shelf-address** → **Settings** →
   **Variables and Secrets** → **Add**, type **Secret**, name
   `GOOGLE_BOOKS_API_KEY`, value the key.

### Optional: deploy automatically on every push

`.github/workflows/deploy.yml` deploys `main` to Cloudflare on push. It stays
dormant until you add one repository secret, so it is safe to leave as is.

To switch it on, create an API token at
**Cloudflare dashboard → My Profile → API Tokens → Create Token**, using the
*Edit Cloudflare Workers* template, then add it to GitHub under
**Settings → Secrets and variables → Actions → New repository secret**:

- Name: `CLOUDFLARE_API_TOKEN`
- Value: the token

Add `CLOUDFLARE_ACCOUNT_ID` the same way (it's in the URL when you're in the
Cloudflare dashboard, and on the Workers overview page).

## Working on it locally

```bash
npm install
npm run db:migrate:local   # create the local copy of the database, once
npm run dev                # http://localhost:3000, fast refresh
```

`npm run dev` uses Next's own dev server. It reads a **local** SQLite database
and a local stand-in for R2 — nothing touches your Cloudflare account, and the
data is separate from production.

To exercise the real Workers runtime instead (slower, no fast refresh, but this
is what actually ships):

```bash
npm run preview            # http://localhost:8787
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run preview` | Build and run in the local Workers runtime |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (address rules) |
| `npm run db:verify` | Assert the schema enforces the spec's rules |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:migrate:remote` | Apply migrations to the Cloudflare database |
| `npm run db:query:local "SELECT …"` | Run one query against the local database |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |

Run `cf-typegen` whenever you add or rename a binding — `cloudflare-env.d.ts`
is generated, not hand-written.

## Layout

```
app/scan/              Scan tab: camera (ZXing), typed ISBN, offline queue UI
app/copies/            one book's page: condition, move, remove
app/api/               JSON API used by the Scan tab's upload queue
app/sections/          location tree: drill-down, A–Z, add/edit forms
app/sections/actions.ts   Server Actions behind the forms
app/status/           bindings health check
lib/cloudflare.ts     getDb() / getBucket() — the binding accessors
lib/locations.ts      location tree queries and writes
lib/location-model.ts types and tree rules, safe for client code
lib/address.ts        address normalising, uniqueness key, near-miss check
lib/version.ts        APP_VERSION ("V1" at the foot of every tab) — bump when shipping
components/app-update.tsx  "A newer version is ready" prompt; registers the service worker
lib/isbn.ts           ISBN-13 validation, ISBN-10 conversion
lib/copies.ts         copy (physical book) queries and writes
lib/scan-queue.ts     offline queue rules (pure, unit tested)
lib/lookup/           Finna / Google Books / Open Library parsers and chain (tested on recorded responses)
lib/editions.ts       lookup runner, covers into R2, retries
lib/catalog.ts        Catalog search: every copy and where it is
lib/client/           phone-side storage (IndexedDB) and upload sync
public/sw.js          service worker: Scan tab opens with no signal
migrations/           D1 schema, applied in filename order
scripts/verify-schema.mjs   schema rule assertions (npm run db:verify)
wrangler.jsonc        Worker name, bindings, compatibility date
open-next.config.ts   Next -> Workers adapter config
docs/                 design spec and decisions taken since
```

## Database notes

`migrations/0001_init.sql` implements spec §2. D1 is SQLite, so the spec's
`JSON`, `TIMESTAMP` and `NUMERIC` columns map to `TEXT` (a JSON document),
`TEXT` (ISO-8601 UTC) and `NUMERIC` respectively.

Rules the spec calls DECIDED are enforced by the database itself rather than
left to application code — a site is always a root, `address` and
`instructions` belong to shelves only, sites never carry an address (shelves
must, sections may), the reference map belongs to sites only,
a copy can never be shelved directly at a site, and every address is unique
across every site (on `address_key`, which folds case including Ä/Ö/Å).
Copies carry no price or stock status — see `docs/spec-corrections.md` §4. `npm run db:verify` asserts all of this against
a throwaway database; it runs in CI on every push.

Migrations are append-only. To change the schema, add `0002_*.sql` — never edit
a migration that has already been applied.
