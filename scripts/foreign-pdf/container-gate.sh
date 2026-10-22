#!/bin/sh
# Fresh actual production image, non-root, --network=none, no app/data mounts.
set -eu
[ "$(id -u)" != 0 ]
[ "$(node --version)" = v22.23.4 ]
[ -f "/app/scripts/foreign-pdf/sandbox-$(node -p process.arch).bpf" ]
[ "${DATABASE_URL:-}" = file:/tmp/bivaro-foreign-compatibility.db ]
node /app/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma
export NEXTAUTH_SECRET=synthetic-foreign-gate-secret-not-production NEXTAUTH_URL=http://127.0.0.1:3000 HOSTNAME=127.0.0.1 PORT=3000
export BIVARO_SETUP_TOKEN=synthetic-foreign-compatibility-bootstrap
DATABASE_MIGRATION_MODE=manual sh /app/docker-entrypoint.sh >/tmp/foreign-server.log 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT INT TERM
ready=0
for n in $(seq 1 40); do
  if curl --silent --fail --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/api/health >/tmp/foreign-health.json; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ]
node scripts/foreign-pdf/native-smoke.mjs
