#!/usr/bin/env bash
#
# Dump the database.
#
# This file is the archive's memory: not just captions and albums, but every
# password hash, every access-control row and the whole audit log. Treat a dump as
# more sensitive than the photographs themselves.
#
# Derivatives are deliberately NOT backed up: they are regenerable from the
# originals by `npm run worker:drain`. Originals are backed up separately, by
# `npm run backup:originals`.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/backup-db.sh [DESTINATION_DIR]
#
# Encryption, in order of preference:
#
#   BACKUP_AGE_RECIPIENT   an age public key ("age1..."). Preferred: the server can
#                          encrypt backups but cannot read them back, so stealing
#                          the machine does not hand over its own history.
#   BACKUP_PASSPHRASE      symmetric, via gpg. Simpler, but the key that opens every
#                          past backup is sitting in the environment that made them.
#
#   Neither set: the dump is written in the clear and this says so loudly. That is
#   only reasonable when the destination directory is itself on encrypted storage.
#
# BACKUP_KEEP  how many dumps to retain in DESTINATION_DIR (default 14).
set -euo pipefail

cd "$(dirname "$0")/.."

DEST="${1:-./var/backups}"
KEEP="${BACKUP_KEEP:-14}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$DEST/autistic-journey-$STAMP.dump"

# --no-owner/--no-privileges so the dump restores into whatever role the target
# database uses, rather than demanding the role names of the source.
DUMP_ARGS=(--format=custom --no-owner --no-privileges --compress=9)

if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null 2>&1 || { echo "BACKUP_AGE_RECIPIENT is set but age is not installed." >&2; exit 1; }
  OUT="$BASE.age"
  pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL" | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT"

elif [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  command -v gpg >/dev/null 2>&1 || { echo "BACKUP_PASSPHRASE is set but gpg is not installed." >&2; exit 1; }
  OUT="$BASE.gpg"
  # --passphrase-fd, never an argument: argv is readable by every process on the box.
  pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL" \
    | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
          --passphrase-fd 3 --output "$OUT" 3<<<"$BACKUP_PASSPHRASE"

else
  OUT="$BASE"
  pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL" --file "$OUT"
  echo "WARNING: this dump is NOT encrypted. It contains every password hash and the" >&2
  echo "         whole audit log. Set BACKUP_AGE_RECIPIENT before storing it anywhere" >&2
  echo "         you do not fully control." >&2
fi

chmod 600 "$OUT"

# A checksum beside the dump, so a truncated or corrupted copy is detectable before
# the day someone actually needs it.
sha256sum "$OUT" | tee "$OUT.sha256" >/dev/null
chmod 600 "$OUT.sha256"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Retention. Only files this script's own naming produces are ever considered, so a
# stray file in the directory is never deleted.
mapfile -t OLD < <(ls -1t "$DEST"/autistic-journey-*.dump "$DEST"/autistic-journey-*.dump.age "$DEST"/autistic-journey-*.dump.gpg 2>/dev/null | tail -n "+$((KEEP + 1))" || true)
for f in "${OLD[@]:-}"; do
  [[ -n "$f" ]] || continue
  rm -f -- "$f" "$f.sha256"
  echo "Removed old backup $f"
done
