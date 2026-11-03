@AGENTS.md

## App version

`APP_VERSION` in `lib/version.ts` is shown as "V<n>" at the foot of every tab,
so the person can tell at a glance whether a phone is running the newest
build. **Bump it by one whenever work ships (before deploying).** It's
hand-maintained on purpose: it marks changes worth noticing, not every commit.
Forget it and two phones on different builds both say the same number.

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

- **Tests live in `e2e/`** (see `e2e/README.md`). The full run
  (`bash e2e/run.sh`) takes about half an hour — the text-reading suites are
  slow. New features get a suite or checks
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
