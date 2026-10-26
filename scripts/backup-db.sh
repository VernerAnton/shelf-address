#!/bin/bash
# Backs up the live database (D1) into the app's own file storage (R2), under
# backups/ — which the app never serves, and which outlives any cloud session.
# Run before every database migration:
#
#   bash scripts/backup-db.sh            # backups/shelf-address-db-<UTC time>.sql
#   bash scripts/backup-db.sh before-0009
#
# Restoring (only if a migration went wrong, and only after checking with the
# owner): download it with `npx wrangler r2 object get shelf-address-media/backups/<file> --remote --file x.sql`
# and run it into a fresh database with `npx wrangler d1 execute ... --remote --file x.sql`.
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
name="shelf-address-db-${stamp}${1:+-$1}.sql"
tmp=".wrangler/${name}"
mkdir -p .wrangler
npx wrangler d1 export shelf-address-db --remote --output "$tmp" > /dev/null
rows=$(grep -c "^INSERT INTO" "$tmp" || true)
npx wrangler r2 object put "shelf-address-media/backups/${name}" --remote --file "$tmp" --content-type "application/sql" > /dev/null
rm -f "$tmp"
echo "backed up ${rows} rows to R2: backups/${name}"
