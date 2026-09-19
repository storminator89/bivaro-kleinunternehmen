#!/bin/sh
#
# Bivaro runtime entrypoint.
#
# Database upgrades are an explicit, operator-run step:
#   node scripts/upgrade-database.mjs
#
# Startup intentionally performs only non-mutating target and migration-status
# checks. It never creates, links, deletes, or synchronises a database.

set -eu

APP_ROOT=${APP_ROOT:-/app}
SCHEMA=${PRISMA_SCHEMA:-$APP_ROOT/prisma/schema.prisma}
PRISMA_CLI=${PRISMA_CLI:-$APP_ROOT/node_modules/prisma/build/index.js}

export APP_ROOT PRISMA_SCHEMA="$SCHEMA" PRISMA_CLI

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required; startup refuses to choose a fallback database." >&2
  exit 1
fi

echo "Starting Bivaro application startup checks..."
node "$APP_ROOT/scripts/database-runtime.mjs" --mode startup

if [ ! -f "$PRISMA_CLI" ]; then
  echo "ERROR: Prisma CLI not found at $PRISMA_CLI; refusing to start without a schema check." >&2
  exit 1
fi

echo "Checking physical schema compatibility without changing the database..."
if ! node "$PRISMA_CLI" migrate diff \
  --from-url="$DATABASE_URL" \
  --to-schema-datamodel="$SCHEMA" \
  --exit-code; then
  echo "ERROR: physical database schema differs from the checked-in Prisma schema; startup is blocked and no repair is attempted." >&2
  exit 1
fi

echo "Checking versioned migrations without changing the database..."
if ! node "$PRISMA_CLI" migrate status --schema="$SCHEMA"; then
  echo "ERROR: database is not migration-compatible. Run the explicit upgrade job, inspect drift, and retry startup." >&2
  exit 1
fi

echo "Database target and migration status are ready. Starting server..."
exec node server.js
