#!/usr/bin/env bash
# Build the UI and upload dist/ to an FTP server.
#
# Configuration: env vars or deploy/.env (gitignored). Required:
#   FTP_HOST       - hostname or IP
#   FTP_USER       - username
#   FTP_PASS       - password
#   FTP_REMOTE_DIR - absolute remote path (e.g. /var/www/xive)
# Optional:
#   FTP_PORT       - default 21
#   FTP_PROTOCOL   - "ftp" (default) or "ftps"
#   SKIP_BUILD     - "1" to skip `npm run build`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UI_DIR="$PROJECT_ROOT/ui"
DIST_DIR="$UI_DIR/dist"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

: "${FTP_HOST:?FTP_HOST is required}"
: "${FTP_USER:?FTP_USER is required}"
: "${FTP_PASS:?FTP_PASS is required}"
: "${FTP_REMOTE_DIR:?FTP_REMOTE_DIR is required}"
FTP_PORT="${FTP_PORT:-21}"
FTP_PROTOCOL="${FTP_PROTOCOL:-ftp}"

if ! command -v lftp >/dev/null 2>&1; then
  echo "error: lftp is not installed. Install it (apt: lftp, brew: lftp) and retry." >&2
  exit 1
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "→ building UI"
  ( cd "$UI_DIR" && npm run build )
else
  echo "→ skipping build (SKIP_BUILD=1)"
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "error: $DIST_DIR is missing. Run a build first." >&2
  exit 1
fi

echo "→ uploading $DIST_DIR → ${FTP_PROTOCOL}://${FTP_USER}@${FTP_HOST}:${FTP_PORT}${FTP_REMOTE_DIR}"

# `mirror -R` = reverse mirror (local → remote)
# `--delete` removes orphaned remote files so old hashed assets don't pile up
# `--parallel=4` parallel transfers
# `--exclude-glob .DS_Store` skips macOS junk
lftp -u "$FTP_USER,$FTP_PASS" -p "$FTP_PORT" "$FTP_PROTOCOL://$FTP_HOST" <<EOF
set ftp:ssl-allow ${FTP_PROTOCOL/ftps/yes}
set ssl:verify-certificate no
mkdir -p $FTP_REMOTE_DIR
cd $FTP_REMOTE_DIR
mirror -R --delete --parallel=4 --exclude-glob .DS_Store $DIST_DIR/ .
bye
EOF

echo "✓ deployed"
