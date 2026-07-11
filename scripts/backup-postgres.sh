#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/lead-finder}"
LOG_PREFIX='[backup]'
# shellcheck source=lib/deploy-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-common.sh"
BACKUP_DIR="${BACKUP_DIR:-$(config_value BACKUP_DIR "${APP_DIR}/backups")}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$(config_value BACKUP_RETENTION_DAYS 7)}"
validate_backup_settings "$APP_DIR" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
[[ -f docker-compose.yml && -f docker-compose.production.yml ]] || die "Execute a partir de ${APP_DIR}."
umask 077
mkdir -p -- "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
target="${BACKUP_DIR}/leadfinder-$(date -u +'%Y%m%dT%H%M%SZ').dump"
[[ ! -e "$target" ]] || die "O backup ja existe: ${target}"
temporary="${target}.partial"
trap 'rm -f -- "$temporary"' EXIT
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml exec -T postgres sh -ceu 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$temporary"
[[ -s "$temporary" ]] || die 'pg_dump gerou um arquivo vazio.'
mv -- "$temporary" "$target"
chmod 600 "$target"
trap - EXIT
find "$BACKUP_DIR" -xdev -maxdepth 1 -type f -name 'leadfinder-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
printf '%s\n' "$target"
