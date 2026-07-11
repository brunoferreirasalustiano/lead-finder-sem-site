#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/lead-finder}"
DEPLOY_USER="${DEPLOY_USER:-leadfinder-deploy}"
DEPLOY_REF="${DEPLOY_REF:-main}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
compose() { docker compose --env-file .env "${COMPOSE_FILES[@]}" "$@"; }

[[ "${EUID}" -ne 0 ]] || die 'Nao execute o deploy como root.'
[[ "$(id -un)" == "${DEPLOY_USER}" ]] || die "Execute como ${DEPLOY_USER}."
[[ "$(pwd -P)" == "$(realpath "${APP_DIR}")" ]] || die "Execute a partir de ${APP_DIR}."
[[ -d .git && -f docker-compose.yml && -f docker-compose.production.yml ]] || die 'Repositorio ou arquivos Compose ausentes.'
[[ -f .env ]] || die '.env ausente.'
[[ "$(stat -c '%a' .env)" == 600 ]] || die '.env deve ter permissao 600.'
[[ -z "$(git status --porcelain)" ]] || die 'A arvore Git possui alteracoes locais; deploy cancelado.'
git check-ref-format --branch "${DEPLOY_REF}" >/dev/null 2>&1 || git rev-parse --verify "${DEPLOY_REF}^{commit}" >/dev/null 2>&1 || die 'DEPLOY_REF invalido.'

current_sha="$(git rev-parse HEAD)"
target_sha="$(git rev-parse "${DEPLOY_REF}^{commit}")"
log "Atual: ${current_sha}; alvo: ${DEPLOY_REF} (${target_sha})."
compose config --quiet
scripts/backup-postgres.sh

rollback() {
  local exit_code=$?
  trap - ERR
  log "Falha detectada; retornando o codigo para ${current_sha}."
  git checkout --detach "${current_sha}" || true
  compose build api worker || true
  compose up -d postgres api worker caddy || true
  log 'Rollback de codigo solicitado. Migrations devem ser backward-compatible e nao sao revertidas automaticamente.'
  exit "${exit_code}"
}
trap rollback ERR

git checkout --detach "${target_sha}"
compose config --quiet
compose build api worker
compose up -d postgres
compose run --rm migrate
compose up -d api worker caddy

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until compose ps --format json | jq -e 'select(.Service == "api" and .Health == "healthy")' >/dev/null; do
  (( SECONDS < deadline )) || die 'Timeout aguardando healthcheck da API.'
  sleep 5
done
compose exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
trap - ERR
log "Deploy concluido no commit ${target_sha}."

