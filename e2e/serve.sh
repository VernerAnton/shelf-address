#!/bin/bash
# Starts the local app for poking at by hand or with a one-off script: a fresh
# database with the given seed (places | shelves | none), the book-service
# stand-in, `wrangler dev` on 127.0.0.1:8788. Stops whatever run.sh/serve.sh
# started before. `bash e2e/serve.sh stop` just stops.
cd "$(dirname "$0")/.."
BOOKS=http://127.0.0.1:8790
kill $(ps -eo pid,args | grep -E "[w]rangler-dist/cli.js dev|[w]orkerd serve|[n]ode e2e/mock-books.cjs" | awk '{print $1}') 2>/dev/null
for i in $(seq 1 30); do ps -eo args | grep -qE "[w]orkerd serve|[w]rangler-dist/cli.js dev" || break; sleep 1; done
[ "$1" = "stop" ] && exit 0
rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/r2
npm run db:migrate:local > /dev/null 2>&1
case "${1:-places}" in
  places) npx wrangler d1 execute DB --local --file e2e/fixtures/places.sql > /dev/null 2>&1 ;;
  shelves) npx wrangler d1 execute DB --local --file e2e/fixtures/store-shelves.sql > /dev/null 2>&1 ;;
esac
(nohup node e2e/mock-books.cjs > .wrangler/e2e-books.log 2>&1 &)
(nohup npx wrangler dev --port 8788 --local \
  --var FINNA_API_BASE:$BOOKS --var FINNA_COVER_BASE:$BOOKS --var GOOGLE_BOOKS_API_BASE:$BOOKS \
  --var OPEN_LIBRARY_BASE:$BOOKS --var OPEN_LIBRARY_COVERS_BASE:$BOOKS \
  --var OPENROUTER_BASE:$BOOKS/api/v1 --var OPENROUTER_API_KEY:test-openrouter-key --var EXTRACT_CODE:test-code \
  > .wrangler/e2e-wrangler.log 2>&1 &)
curl -s --noproxy '*' --retry 90 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null http://127.0.0.1:8788/api/version
echo "serving on http://127.0.0.1:8788 (seed: ${1:-places})"
