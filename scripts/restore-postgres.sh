#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/lead-finder}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 1 ]] || die 'Uso: scripts/restore-postgres.sh /caminho/backup.dump'
[[ -f docker-compose.yml && -f docker-compose.production.yml ]] || die "Execute a partir de ${APP_DIR}."
backup="$1"
[[ -f "${backup}" && -r "${backup}" && -s "${backup}" ]] || die 'Backup inexistente, ilegivel ou vazio.'
docker compose "${COMPOSE_FILES[@]}" exec -T postgres pg_restore --list < "${backup}" >/dev/null || die 'Arquivo nao e um dump custom valido.'
printf 'Esta operacao substituira objetos no PostgreSQL da stack. Digite RESTAURAR para continuar: ' >&2
read -r confirmation
[[ "${confirmation}" == RESTAURAR ]] || die 'Restauracao cancelada.'

docker compose "${COMPOSE_FILES[@]}" stop api worker
restore_status=0
docker compose "${COMPOSE_FILES[@]}" exec -T postgres sh -ceu 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "${backup}" || restore_status=$?
docker compose "${COMPOSE_FILES[@]}" up -d api worker
(( restore_status == 0 )) || die "pg_restore falhou com codigo ${restore_status}; os servicos foram reiniciados para diagnostico."
printf '[restore] Restauracao concluida a partir de %s\n' "${backup}"
