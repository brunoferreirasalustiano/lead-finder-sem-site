#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

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
manifest_parent="$(realpath "$(dirname "$manifest")")"
[[ "$manifest_parent" == "$BACKUP_DIR" ]] || die 'O manifesto deve ser criado diretamente em BACKUP_DIR.'
manifest_name="$(basename "$manifest")"
[[ "$manifest_name" == *.suppression-manifest.json ]] || die 'O manifesto deve usar o sufixo .suppression-manifest.json.'
manifest="$manifest_parent/$manifest_name"
manifest_container="/restore-manifests/$manifest_name"
key_name="$manifest_name.precontact-hmac-key"
key_capsule="$manifest_parent/$key_name"
key_container="/restore-manifests/$key_name"
export RESTORE_SUPPRESSION_MANIFEST_DIR="$BACKUP_DIR"

cleanup_key_capsule() {
  if [[ -e "$key_capsule" ]]; then
    rm -f -- "$key_capsule" || {
      printf '[restore] ALERTA: falha ao remover a capsula HMAC temporaria; mantenha os servicos parados e remova o arquivo manualmente.\n' >&2
      return 0
    }
  fi
}
trap cleanup_key_capsule EXIT

docker compose "${COMPOSE_FILES[@]}" exec -T postgres pg_restore --list < "${backup}" >/dev/null || die 'Arquivo nao e um dump custom valido.'
printf 'Esta operacao substituira objetos no PostgreSQL da stack. Digite RESTAURAR para continuar: ' >&2
read -r confirmation
[[ "${confirmation}" == RESTAURAR ]] || die 'Restauracao cancelada.'

docker compose "${COMPOSE_FILES[@]}" stop api worker
[[ ! -e "$manifest" ]] || die 'O manifesto de saida ja existe.'
[[ ! -e "$key_capsule" ]] || die 'A capsula HMAC temporaria ja existe.'
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:export -- --output "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:validate -- --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:key:export -- --output "$key_container" --manifest "$manifest_container"
restore_status=0
docker compose "${COMPOSE_FILES[@]}" exec -T postgres sh -ceu 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "${backup}" || restore_status=$?
(( restore_status == 0 )) || die "pg_restore falhou com codigo ${restore_status}; API e worker permanecem parados."
docker compose "${COMPOSE_FILES[@]}" run --rm migrate
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:key:recover -- --key-file "$key_container" --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:apply -- --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:apply -- --manifest "$manifest_container" --apply --actor "${RESTORE_SUPPRESSION_ACTOR:-restore-operator}"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:verify -- --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run pilot:real:preflight -- --restore-suppression-only
rm -f -- "$key_capsule" || die 'Falha ao remover a capsula HMAC temporaria; API e worker permanecem parados.'
[[ ! -e "$key_capsule" ]] || die 'Capsula HMAC temporaria ainda presente; API e worker permanecem parados.'
trap - EXIT
if [[ "${RESTORE_RESUME_SERVICES:-false}" == true ]]; then
  docker compose "${COMPOSE_FILES[@]}" up -d api worker
  printf '[restore] RESTORE_SUPPRESSION_SAFE; retomada controlada concluida.\n'
else
  printf '[restore] RESTORE_SUPPRESSION_SAFE; API e worker permanecem parados ate liberacao operacional.\n'
fi
