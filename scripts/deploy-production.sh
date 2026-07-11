#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/lead-finder}"
DEPLOY_USER="${DEPLOY_USER:-leadfinder-deploy}"
DEPLOY_REF="${DEPLOY_REF:-main}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
LOG_PREFIX='[deploy]'
# shellcheck source=lib/deploy-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-common.sh"

[[ "$EUID" -ne 0 ]] || die 'Nao execute o deploy como root.'
[[ "$(id -un)" == "$DEPLOY_USER" ]] || die "Execute como ${DEPLOY_USER}."
[[ "$(pwd -P)" == "$(realpath "$APP_DIR")" ]] || die "Execute a partir de ${APP_DIR}."
[[ -d .git && -f docker-compose.yml && -f docker-compose.production.yml ]] || die 'Repositorio ou Compose ausente.'
[[ -f .env && "$(stat -c '%a' .env)" == 600 ]] || die '.env deve existir com permissao 600.'
[[ -z "$(git status --porcelain)" ]] || die 'A arvore Git possui alteracoes locais.'
target_sha="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")" || die 'DEPLOY_REF invalido.'
current_sha="$(git rev-parse HEAD)"
DEPLOY_MODE="$(config_value DEPLOY_MODE tunnel)"
ENABLE_N8N="$(config_value ENABLE_N8N false)"
BACKUP_DIR="$(config_value BACKUP_DIR "${APP_DIR}/backups")"
BACKUP_RETENTION_DAYS="$(config_value BACKUP_RETENTION_DAYS 7)"
validate_backup_settings "$APP_DIR" "$BACKUP_DIR" "$BACKUP_RETENTION_DAYS"
[[ "$ENABLE_N8N" == true || "$ENABLE_N8N" == false ]] || die 'ENABLE_N8N deve ser true ou false.'

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)
COMPOSE_PROFILE_ARGS=()
SERVICES=(postgres api worker)
if [[ "$DEPLOY_MODE" == tunnel ]]; then
  [[ "$ENABLE_N8N" == false ]] || die 'n8n exige DEPLOY_MODE=public.'
  COMPOSE_FILES+=(-f deploy/docker-compose.tunnel.yml)
elif [[ "$DEPLOY_MODE" == public ]]; then
  COMPOSE_FILES+=(-f deploy/docker-compose.public.yml)
  API_DOMAIN="$(config_value API_DOMAIN '')"
  ACME_EMAIL="$(config_value ACME_EMAIL '')"
  CADDYFILE_PATH="$(config_value CADDYFILE_PATH '')"
  validate_public_domain API_DOMAIN "$API_DOMAIN"
  [[ "$ACME_EMAIL" == *@*.* && "$ACME_EMAIL" != *DOMINIO_EXEMPLO* ]] || die 'ACME_EMAIL valido e obrigatorio no modo public.'
  [[ -n "$CADDYFILE_PATH" && -f "$CADDYFILE_PATH" ]] || die 'CADDYFILE_PATH deve apontar para arquivo existente.'
  SERVICES+=(caddy)
  if [[ "$ENABLE_N8N" == true ]]; then
    N8N_DOMAIN="$(config_value N8N_DOMAIN '')"
    N8N_ENCRYPTION_KEY="$(config_value N8N_ENCRYPTION_KEY '')"
    validate_public_domain N8N_DOMAIN "$N8N_DOMAIN"
    [[ ${#N8N_ENCRYPTION_KEY} -ge 32 && "$N8N_ENCRYPTION_KEY" != GENERATE_* ]] || die 'N8N_ENCRYPTION_KEY forte e obrigatoria.'
    COMPOSE_PROFILE_ARGS=(--profile n8n)
    SERVICES+=(n8n)
  fi
else die 'DEPLOY_MODE deve ser tunnel ou public.'; fi
compose() { docker compose --env-file .env "${COMPOSE_FILES[@]}" "${COMPOSE_PROFILE_ARGS[@]}" "$@"; }
compose config --quiet

existing_postgres="$(compose ps -a -q postgres)"
start_previous_database() { compose up -d postgres; }
wait_previous_database() {
  local container_id="$1"
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container_id")" == healthy ]]; do
    (( SECONDS < deadline )) || die 'PostgreSQL anterior nao ficou saudavel; deploy cancelado.'
    sleep 3
  done
}
create_predeploy_backup() {
  APP_DIR="$APP_DIR" BACKUP_DIR="$BACKUP_DIR" BACKUP_RETENTION_DAYS="$BACKUP_RETENTION_DAYS" scripts/backup-postgres.sh >/dev/null
}
perform_predeploy_backup "$existing_postgres" start_previous_database wait_previous_database create_predeploy_backup

rollback() {
  local code=$?
  trap - ERR
  log "Falha; restaurando codigo ${current_sha}."
  git checkout --detach "$current_sha" || true
  compose build api worker || true
  compose up -d "${SERVICES[@]}" || true
  log 'Rollback de codigo executado; schema nao e revertido automaticamente.'
  exit "$code"
}
trap rollback ERR
git checkout --detach "$target_sha"
compose build api worker
compose up -d postgres
compose run --rm migrate
if [[ "${DEPLOY_TEST_FORCE_FAILURE:-false}" == true ]]; then
  log 'Falha controlada para validar rollback.'
  false
fi
compose up -d "${SERVICES[@]}"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until compose exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  if (( SECONDS >= deadline )); then
    log 'ERROR: timeout aguardando /health/ready.'
    false
  fi
  sleep 3
done
trap - ERR
log "Deploy ${DEPLOY_MODE} concluido em ${target_sha}."
