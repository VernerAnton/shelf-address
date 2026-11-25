@AGENTS.md

## App version

`APP_VERSION` in `lib/version.ts` is shown as "V<n>" at the foot of every tab,
so the person can tell at a glance whether a phone is running the newest
build. **Bump it whenever work ships (before deploying)** — the owner's rule:

- **Small fix or tweak:** add .1 — "32" → "32.1" → "32.2".
- **Big change:** the next whole number — "32.2" → "33".

It's a string (so "32.10" stays itself) and hand-maintained on purpose: it
marks changes worth noticing, not every commit. Forget it and two phones on
different builds both say the same number.

## Update detection — deliberate, don't "simplify"

`components/app-update.tsx` registers `public/sw.js` and offers a reload when a
newer build is deployed. It detects that by comparing the build id compiled
into the page with the one `/api/version` reports.

It does **not** rely on service-worker update events, and must not be changed
to: `public/sw.js` is hand-written and byte-identical across deploys, so the
browser never sees a new worker, and an event-based check would silently report
"up to date" forever. It also never reloads by itself — a reload nobody asked
for loses a half-typed form or a scan in progress. `/api/*` is excluded from the
service worker's caching; keep it that way or `/api/version` goes stale.

## Keep everything in the repository

The cloud sessions this is built in are reset from time to time, wiping
everything outside the pushed repository — scratch folders included. Test
suites and their fixtures once lived in a scratch folder and were lost that
way. So:

- **Tests live in `e2e/`** (see `e2e/README.md`). The full run is
  `node e2e/run-fast.cjs` — 3 suites at a time, each on its own server, about
  5 minutes (`bash e2e/run.sh` runs them one by one: over 30 minutes). Name
  suites to run just those. New features get a suite or checks
  there, committed with the feature. Never keep tests, fixtures or helper
  scripts only in a scratch folder.
- **Database backups go to R2**: `bash scripts/backup-db.sh` before every
  migration. Never rely on a backup file in a local folder.

## Shipping: small changes go straight through

The owner's standard (agreed in conversation): don't make them wait for the
full test run on a small change.

- **Small change** (wording, layout, a button, a redirect — no database
  change): typecheck, lint and unit tests, build, bump `APP_VERSION`, commit,
  push and deploy straight away (`npx opennextjs-cloudflare deploy` deploys
  the build just made, without rebuilding). Then run the full e2e suite in
  the background; if something fails, fix it and ship the fix the same way.
- **Bigger change, or anything that changes the database:** run the full
  suite first, back up to R2 (`bash scripts/backup-db.sh`), and get the
  owner's go-ahead before migrating and deploying.
- **Applying a migration:** `CI=true npx wrangler d1 migrations apply
  shelf-address-db --remote`. Without `CI=true` wrangler waits for a "yes"
  that a cloud session can't give, and quietly applies nothing. Check with
  `npx wrangler d1 migrations list shelf-address-db --remote` before
  deploying the code that needs it.

## One line of work at a time

Every session deploys to the same live app. In November two sessions worked
on separate branches from different starting points, both deploying: each
release from one silently removed the other's features from the live app
(BookOps vanished for days; both used V26–V32). See spec-corrections §31.

- **Before deploying, check the live app is a build of your branch's
  history:** `curl -s https://shelf-address.verner-sdr.workers.dev/api/version`
  gives the commit it was built from (`buildId`, before the `@`); it must be
  an ancestor of HEAD (`git merge-base --is-ancestor <commit> HEAD`). If it
  isn't, someone else deployed: fetch, merge their branch (or main) in first.
- **Start new work from the latest main**, and keep main up to date (the
  owner merges the branch on GitHub), so the next session starts from it.
