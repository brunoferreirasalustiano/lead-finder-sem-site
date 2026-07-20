#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required and must reference a disposable empty database}"
: "${BACKUP_INPUT:?BACKUP_INPUT is required}"
if [[ "${CONFIRM_DISPOSABLE_RESTORE:-}" != 'yes' ]]; then
  echo 'refusing_restore_without_CONFIRM_DISPOSABLE_RESTORE=yes' >&2
  exit 2
fi
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$BACKUP_INPUT"
echo 'restore_completed_run_verify_database_migration_next'
