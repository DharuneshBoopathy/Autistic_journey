#!/usr/bin/env bash
#
# Prove the backups work.
#
# A backup nobody has restored is a hypothesis, not a backup. This takes a fresh
# dump, restores it into a scratch database, checks the row counts match, and then
# runs the full authorization suite against the *restored copy* — because a restore
# that brings back the rows but not the `visible_photos` view, its grants or the
# append-only audit trigger would look like a success and be a catastrophe.
#
# It never writes to the source database, and it drops the scratch database when it
# is done. Run it on a schedule, not just the day you set backups up.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/backup-drill.sh
#
# By default it creates and drops its own scratch database. Managed Postgres often
# does not allow that, so DRILL_DATABASE_URL can name an existing empty database to
# restore into instead — it is wiped at the start of the drill and left in place
# afterwards, so point it somewhere disposable.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [[ -n "${DRILL_DATABASE_URL:-}" ]]; then
  SCRATCH_URL="$DRILL_DATABASE_URL"
  OWN_SCRATCH=0

  if [[ "$SCRATCH_URL" == "$DATABASE_URL" ]]; then
    echo "DRILL_DATABASE_URL must not be the live database." >&2
    exit 1
  fi
else
  SCRATCH_DB="aj_drill_$$"
  # Swap the database name in the URL, keeping host, port and credentials.
  SCRATCH_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|\$)#/$SCRATCH_DB\1#")"
  ADMIN_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|\$)#/postgres\1#")"
  OWN_SCRATCH=1
fi

cleanup() {
  if [[ "$OWN_SCRATCH" == 1 ]]; then
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== 1. Take a dump"
DEST="$(mktemp -d)"
./scripts/backup-db.sh "$DEST" 2>&1 | sed 's/^/   /'
DUMP="$(ls -1t "$DEST"/autistic-journey-* | grep -v '\.sha256$' | head -1)"

echo
echo "== 2. Restore it into the scratch database"
if [[ "$OWN_SCRATCH" == 1 ]]; then
  if ! psql "$ADMIN_URL" -q -c "CREATE DATABASE $SCRATCH_DB" 2>/dev/null; then
    echo "   Could not create a scratch database — the role may lack CREATEDB, which" >&2
    echo "   is normal on managed Postgres. Provision an empty database and set" >&2
    echo "   DRILL_DATABASE_URL to it, then run this again." >&2
    exit 1
  fi
fi

# --force because a reused DRILL_DATABASE_URL still holds the previous drill.
TARGET_DATABASE_URL="$SCRATCH_URL" ./scripts/restore-db.sh "$DUMP" --force 2>&1 | sed 's/^/   /'

echo
echo "== 3. Compare the two"
for table in users photos albums groups events tags audit_logs photo_acl album_photos group_members; do
  SRC="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $table")"
  DST="$(psql "$SCRATCH_URL" -tAc "SELECT count(*) FROM $table")"
  if [[ "$SRC" == "$DST" ]]; then
    printf '   %-16s %s\n' "$table" "$SRC"
  else
    printf '   %-16s SOURCE %s but RESTORED %s\n' "$table" "$SRC" "$DST" >&2
    exit 1
  fi
done

echo
echo "== 4. Run the authorization suite against the restored copy"
# Against the restore, not the source: this is what proves the view, its grants and
# the append-only trigger came back, not merely the rows.
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f tests/authorization.sql > /dev/null
echo "   All authorization assertions passed against the restored database."

rm -rf "$DEST"
echo
echo "Drill passed. The dump restores, the data matches, and the predicate still holds."
