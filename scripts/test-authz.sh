#!/usr/bin/env bash
#
# Runs the authorization test suite against a real Postgres.
#
# The authorization predicate lives in SQL, so it is tested in SQL — against the
# actual view the application queries, not a mock of it. Every assertion aborts the
# run on failure (ON_ERROR_STOP + RAISE EXCEPTION).
#
# Usage:  DATABASE_URL=postgres://... ./scripts/test-authz.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

echo "Applying migrations..."
npx tsx src/db/migrate.ts

echo "Running authorization assertions..."
# The suite clears and repopulates the archive inside a transaction it always rolls
# back, so it leaves the database exactly as it found it and can run alongside the
# end-to-end suite in any order.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/authorization.sql

echo
echo "Authorization suite passed."
