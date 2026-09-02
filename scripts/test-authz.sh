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
# A dedicated schema-reset keeps the suite independent of whatever is already there.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
TRUNCATE audit_logs, photo_acl, photo_tags, album_photos, photo_derivatives,
         processing_jobs, download_grants, photos, group_members, groups,
         albums, tags, events, upload_batches, invites, sessions, users, batches
  RESTART IDENTITY CASCADE;
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/authorization.sql

echo
echo "Authorization suite passed."
