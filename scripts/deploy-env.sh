#!/usr/bin/env bash
#
# Print the environment variables a deployment needs, with a freshly generated
# session secret.
#
# The secret is generated here, on your machine, and printed once. It is not
# committed, not logged, and not sent anywhere — paste it straight into the
# platform's variable editor and close the terminal. Anything pasted into a chat
# window, a ticket or a commit is no longer a secret.
#
# Usage:
#   ./scripts/deploy-env.sh archive.yourdomain.com
#   ./scripts/deploy-env.sh archive.yourdomain.com --single-service
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain> [--single-service]" >&2
  echo "  e.g. $0 archive.example.com" >&2
  exit 1
fi

# One process doing both jobs, for hosting that will not run a second one.
SINGLE=""
for arg in "$@"; do
  [[ "$arg" == "--single-service" ]] && SINGLE=1
done

SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"

cat <<VARS
NODE_ENV=production
APP_ORIGIN=https://$DOMAIN
SESSION_SECRET=$SECRET
DELETED_RETENTION_DAYS=30
MAX_UPLOAD_BYTES=52428800
VARS

if [[ -n "$SINGLE" ]]; then
  cat <<'VARS'
WORKER_IN_PROCESS=true
VARS
fi

cat <<'VARS'

# --- Storage: choose one, and read docs/OPERATIONS.md first ------------------
# Cloudflare R2 (needs a card on file, 10 GB free):
# STORAGE_DERIVATIVES_DRIVER=r2
# STORAGE_ORIGINALS_DRIVER=r2
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=
#
# A disk you control (a virtual machine with a persistent volume):
# STORAGE_DERIVATIVES_DRIVER=local
# STORAGE_ORIGINALS_DRIVER=local
# STORAGE_LOCAL_PATH=/data/storage
# STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true
VARS

echo
echo "DATABASE_URL comes from the platform's own Postgres. Do not type it by hand." >&2
echo "The session secret above is shown once. Rotating it signs everyone out." >&2
