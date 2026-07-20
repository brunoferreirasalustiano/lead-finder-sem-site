#!/usr/bin/env bash
set -euo pipefail
: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL is required}"
: "${BACKUP_OUTPUT:?BACKUP_OUTPUT is required}"
umask 077
pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_OUTPUT" "$DIRECT_DATABASE_URL"
pg_restore --list "$BACKUP_OUTPUT" >/dev/null
echo 'backup_validated'
