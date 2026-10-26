#!/bin/bash
# End-to-end tests in a real (headless) Chromium against the local Worker.
#
#   npx opennextjs-cloudflare build      # once, after changing the app
#   bash e2e/run.sh e2e-extract.cjs e2e-nav.cjs ...
#
# Each suite gets a fresh local database (migrated, plus a small seed unless
# NOSEED=1) and its own `wrangler dev` on 127.0.0.1:8788. Nothing here touches
# production. Playwright comes from the global install (npm root -g).
cd "$(dirname "$0")/.."
stop() {
  kill $(ps -eo pid,args | grep -E "[w]rangler-dist/cli.js dev|[w]orkerd serve" | awk '{print $1}') 2>/dev/null
  for i in $(seq 1 30); do ps -eo args | grep -qE "[w]orkerd serve|[w]rangler-dist/cli.js dev" || break; sleep 1; done
}
for t in "$@"; do
  stop
  rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/r2
  npm run db:migrate:local > /dev/null 2>&1
  [ -z "$NOSEED" ] && npx wrangler d1 execute DB --local --command "INSERT INTO locations (id,parent_id,kind,label,sort_order) VALUES ('s1',NULL,'site','Store',0),('w1',NULL,'site','Warehouse A',0); INSERT INTO locations (id,parent_id,kind,label,address,address_key) VALUES ('sh1','s1','shelf','Wall unit','Bulevard 1','bulevard 1'); INSERT INTO locations (id,parent_id,kind,label) VALUES ('r2','sh1','node','Row 2'),('b1','w1','node','Box 3');" > /dev/null 2>&1
  (nohup npx wrangler dev --port 8788 --local > .wrangler/e2e-wrangler.log 2>&1 &)
  curl -s --noproxy '*' --retry 90 --retry-delay 1 --retry-connrefused --retry-all-errors -o /dev/null http://127.0.0.1:8788/api/version
  echo "== $t: $(timeout 900 node e2e/$t 2>&1 | tail -8 | tr '\n' ' ')"
done
stop
