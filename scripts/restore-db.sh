#!/usr/bin/env bash
#
# Restore a dump made by scripts/backup-db.sh.
#
# The dangerous direction. This overwrites whatever is in the target database, so it
# refuses to touch one that already has tables unless --force says otherwise. The
# common disaster is not "the restore failed" but "the restore succeeded, into
# production, on the wrong day".
#
# Usage:
#   TARGET_DATABASE_URL=postgres://... ./scripts/restore-db.sh path/to.dump[.age|.gpg] [--force]
#
# Decryption:
#   .age  needs BACKUP_AGE_IDENTITY — a path to the age private key file.
#   .gpg  needs BACKUP_PASSPHRASE.
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
FORCE="${2:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: TARGET_DATABASE_URL=... $0 <dump file> [--force]" >&2
  exit 1
fi

TARGET="${TARGET_DATABASE_URL:-}"
if [[ -z "$TARGET" ]]; then
  echo "TARGET_DATABASE_URL is required." >&2
  echo "It is deliberately not DATABASE_URL: restoring is not something to do by" >&2
  echo "inheriting whatever happened to be in the shell." >&2
  exit 1
fi

# Verify the checksum first. A dump that has rotted on disk should be discovered
# here, not halfway through writing over a database.
if [[ -f "$DUMP.sha256" ]]; then
  if sha256sum --check --status "$DUMP.sha256"; then
    echo "Checksum ok."
  else
    echo "CHECKSUM MISMATCH for $DUMP — refusing to restore it." >&2
    exit 1
  fi
else
  echo "No .sha256 beside $DUMP; continuing without an integrity check." >&2
fi

EXISTING="$(psql "$TARGET" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "$EXISTING" -gt 0 && "$FORCE" != "--force" ]]; then
  echo "$TARGET already has $EXISTING tables in public." >&2
  echo "Pass --force to drop and replace them." >&2
  exit 1
fi

if [[ "$FORCE" == "--force" ]]; then
  echo "Dropping the existing public schema..."
  psql "$TARGET" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
fi

RESTORE_ARGS=(--dbname "$TARGET" --no-owner --no-privileges --exit-on-error)

case "$DUMP" in
  *.age)
    [[ -n "${BACKUP_AGE_IDENTITY:-}" ]] || { echo "BACKUP_AGE_IDENTITY (path to the age key) is required for a .age dump." >&2; exit 1; }
    age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$DUMP" | pg_restore "${RESTORE_ARGS[@]}"
    ;;
  *.gpg)
    [[ -n "${BACKUP_PASSPHRASE:-}" ]] || { echo "BACKUP_PASSPHRASE is required for a .gpg dump." >&2; exit 1; }
    gpg --batch --quiet --decrypt --passphrase-fd 3 "$DUMP" 3<<<"$BACKUP_PASSPHRASE" \
      | pg_restore "${RESTORE_ARGS[@]}"
    ;;
  *)
    pg_restore "${RESTORE_ARGS[@]}" "$DUMP"
    ;;
esac

echo
echo "Restored $DUMP into the target database."
psql "$TARGET" -tAc "
  SELECT 'users: ' || (SELECT count(*) FROM users)
      || ', photos: ' || (SELECT count(*) FROM photos)
      || ', audit rows: ' || (SELECT count(*) FROM audit_logs)"
