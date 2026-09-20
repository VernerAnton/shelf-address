# Shelf-Address

Scan a book's barcode, look up its metadata, log where the physical copy lives
in a location tree, and later get a plain-text address to walk to it.

Personal cataloguing tool for a used bookstore and its warehouses. Full design
spec in [`docs/spec.md`](docs/spec.md); decisions taken since the spec was
written are in [`docs/spec-corrections.md`](docs/spec-corrections.md) and
override it where they conflict.

**Status: Phase 1 (scaffold) complete.** The app builds for Cloudflare Workers,
the database schema from §2 is written and verified, and both bindings resolve.
There is no UI beyond a bindings health page yet.

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

Copy that `database_id` into `wrangler.jsonc`, replacing
`"REPLACE_ME_SEE_README"`.

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
| `npm run db:verify` | Assert the schema enforces the spec's rules |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:migrate:remote` | Apply migrations to the Cloudflare database |
| `npm run db:query:local "SELECT …"` | Run one query against the local database |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |

Run `cf-typegen` whenever you add or rename a binding — `cloudflare-env.d.ts`
is generated, not hand-written.

## Layout

```
app/                  Next.js App Router pages
lib/cloudflare.ts     getDb() / getBucket() — the binding accessors
lib/health.ts         bindings health check behind the placeholder page
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
`instructions` belong to shelves only, the reference map belongs to sites only,
a copy can never be shelved directly at a site, and `address` is unique across
every site, case-insensitively. `npm run db:verify` asserts all of this against
a throwaway database; it runs in CI on every push.

Migrations are append-only. To change the schema, add `0002_*.sql` — never edit
a migration that has already been applied.
