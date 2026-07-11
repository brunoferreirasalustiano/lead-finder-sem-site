#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/lead-finder}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }
[[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] || die 'BACKUP_RETENTION_DAYS deve ser inteiro nao negativo.'
[[ -f docker-compose.yml && -f docker-compose.production.yml ]] || die "Execute a partir de ${APP_DIR}."
umask 077
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
target="${BACKUP_DIR}/leadfinder-${timestamp}.dump"
[[ ! -e "${target}" ]] || die "O backup ja existe: ${target}"
temporary="${target}.partial"
trap 'rm -f -- "${temporary}"' EXIT

docker compose "${COMPOSE_FILES[@]}" exec -T postgres sh -ceu 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${temporary}"
[[ -s "${temporary}" ]] || die 'pg_dump gerou um arquivo vazio.'
mv -- "${temporary}" "${target}"
chmod 600 "${target}"
trap - EXIT
find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'leadfinder-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
printf '[backup] Criado: %s\n' "${target}"
