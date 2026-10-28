#!/bin/bash
# End-to-end tests in a real (headless) Chromium against the local Worker.
#
#   npx opennextjs-cloudflare build          # after changing the app
#   bash e2e/run.sh                          # every suite
#   bash e2e/run.sh e2e-extract.cjs ...      # just these
#
# Each suite gets a fresh local database and its own `wrangler dev` on
# 127.0.0.1:8788, with the book lookups pointed at the stand-in
# (mock-books.cjs, 127.0.0.1:8790). Nothing here touches production or the
# real book services. Playwright comes from the global install.
#
# Database for each suite (first line of the suite file decides):
#   // seed: places    a small tree: Store › Wall unit (Bulevard 1) › Row 2; Warehouse A › Box 3
#   // seed: none      empty
#   // seed: shelves   the store's 16 shelves (e2e/fixtures/store-shelves.sql)
cd "$(dirname "$0")/.."
BOOKS=http://127.0.0.1:8790
stop() {
  kill $(ps -eo pid,args | grep -E "[w]rangler-dist/cli.js dev|[w]orkerd serve" | awk '{print $1}') 2>/dev/null
  for i in $(seq 1 30); do ps -eo args | grep -qE "[w]orkerd serve|[w]rangler-dist/cli.js dev" || break; sleep 1; done
}
stop_books() { kill $(ps -eo pid,args | grep -E "[n]ode e2e/mock-books.cjs" | awk '{print $1}') 2>/dev/null; }

suites=("$@")
[ ${#suites[@]} -eq 0 ] && suites=($(cd e2e && ls e2e-*.cjs))
stop_books
(nohup node e2e/mock-books.cjs > .wrangler/e2e-books.log 2>&1 &)
for t in "${suites[@]}"; do
  stop
  stop_books; (nohup node e2e/mock-books.cjs > .wrangler/e2e-books.log 2>&1 &)
  rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/r2
  npm run db:migrate:local > /dev/null 2>&1
  seed=$(head -1 "e2e/$t" | sed -n 's#^// seed: *##p')
  case "${seed:-places}" in
    places) npx wrangler d1 execute DB --local --file e2e/fixtures/places.sql > /dev/null 2>&1 ;;
    shelves) npx wrangler d1 execute DB --local --file e2e/fixtures/store-shelves.sql > /dev/null 2>&1 ;;
  esac
  (nohup npx wrangler dev --port 8788 --local \
    --var FINNA_API_BASE:$BOOKS --var FINNA_COVER_BASE:$BOOKS --var GOOGLE_BOOKS_API_BASE:$BOOKS \
    --var OPEN_LIBRARY_BASE:$BOOKS --var OPEN_LIBRARY_COVERS_BASE:$BOOKS \
    --var OPENROUTER_BASE:$BOOKS/api/v1 --var OPENROUTER_API_KEY:test-openrouter-key --var EXTRACT_CODE:test-code \
    > .wrangler/e2e-wrangler.log 2>&1 &)
  curl -s --noproxy '*' --retry 90 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null http://127.0.0.1:8788/api/version
  echo "== $t: $(timeout 1200 node e2e/$t 2>&1 | tail -12 | tr '\n' ' ')"
done
stop
stop_books
