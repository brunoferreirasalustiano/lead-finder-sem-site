#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/lead-finder}"
LOG_PREFIX='[restore]'
# shellcheck source=lib/deploy-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-common.sh"
BACKUP_DIR="${BACKUP_DIR:-$(config_value BACKUP_DIR "${APP_DIR}/backups")}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$(config_value BACKUP_RETENTION_DAYS 7)}"
validate_backup_settings "$APP_DIR" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

[[ $# -eq 2 ]] || die 'Uso: scripts/restore-postgres.sh /caminho/backup.dump /caminho/manifest.suppression-manifest.json'
[[ -f docker-compose.yml && -f docker-compose.production.yml ]] || die "Execute a partir de ${APP_DIR}."
backup="$1"
manifest="$2"
[[ -f "${backup}" && -r "${backup}" && -s "${backup}" ]] || die 'Backup inexistente, ilegivel ou vazio.'
backup="$(realpath "$backup")"
case "$backup" in "$BACKUP_DIR"/*) ;; *) die 'O backup deve estar dentro de BACKUP_DIR.' ;; esac
docker compose "${COMPOSE_FILES[@]}" exec -T postgres pg_restore --list < "${backup}" >/dev/null || die 'Arquivo nao e um dump custom valido.'
printf 'Esta operacao substituira objetos no PostgreSQL da stack. Digite RESTAURAR para continuar: ' >&2
read -r confirmation
[[ "${confirmation}" == RESTAURAR ]] || die 'Restauracao cancelada.'

docker compose "${COMPOSE_FILES[@]}" stop api worker
[[ -n "${DATABASE_URL:-}" ]] || die 'DATABASE_URL e obrigatoria para reconciliacao.'
[[ ! -e "$manifest" ]] || die 'O manifesto de saida ja existe.'
npm run restore:suppression:export -- --output "$manifest"
npm run restore:suppression:validate -- --manifest "$manifest"
restore_status=0
docker compose "${COMPOSE_FILES[@]}" exec -T postgres sh -ceu 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "${backup}" || restore_status=$?
(( restore_status == 0 )) || die "pg_restore falhou com codigo ${restore_status}; API e worker permanecem parados."
docker compose "${COMPOSE_FILES[@]}" run --rm migrate
npm run restore:suppression:apply -- --manifest "$manifest"
npm run restore:suppression:apply -- --manifest "$manifest" --apply --actor "${RESTORE_SUPPRESSION_ACTOR:-restore-operator}"
npm run restore:suppression:verify -- --manifest "$manifest"
npm run pilot:real:preflight -- --restore-suppression-only
printf '[restore] RESTORE_SUPPRESSION_SAFE; API e worker permanecem parados ate liberacao operacional: %s\n' "${backup}"
