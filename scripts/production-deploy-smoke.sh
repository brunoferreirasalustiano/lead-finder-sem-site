#!/usr/bin/env bash
set -Eeuo pipefail
source_dir="$(pwd -P)"
workspace="$(mktemp -d)"
app_dir="$workspace/lead-finder"
project="deploysmoke${RANDOM}"
cleanup() {
  if [[ -d "$app_dir" ]]; then
    cd "$app_dir"
    docker compose -p "$project" --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml down -v --remove-orphans >/dev/null 2>&1 || true
    docker compose -p "${project}public" --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf -- "$workspace"
}
trap cleanup EXIT

git clone --local "$source_dir" "$app_dir" >/dev/null
cd "$app_dir"
git config user.name deploy-smoke
git config user.email deploy-smoke@example.invalid
base_sha="$(git rev-parse HEAD)"
git commit --allow-empty -m 'test: update target' >/dev/null
update_sha="$(git rev-parse HEAD)"
git commit --allow-empty -m 'test: rollback target' >/dev/null
failure_sha="$(git rev-parse HEAD)"
git checkout --detach "$base_sha" >/dev/null
cat > .env <<ENV
COMPOSE_PROJECT_NAME=$project
POSTGRES_DB=leadfinder
POSTGRES_USER=leadfinder
POSTGRES_PASSWORD=smoke-only-password
DATABASE_URL=postgresql://leadfinder:smoke-only-password@postgres:5432/leadfinder
API_PORT=3000
DEPLOY_MODE=tunnel
ENABLE_N8N=false
OVERPASS_URL=http://127.0.0.1:9
OVERPASS_TIMEOUT_MS=1000
OVERPASS_MAX_RETRIES=0
WORKER_POLL_INTERVAL_MS=1000
DAILY_LEAD_LIMIT=50
BACKUP_DIR=$app_dir/backups
BACKUP_RETENTION_DAYS=7
ENV
chmod 600 .env
export APP_DIR="$app_dir" DEPLOY_USER="$(id -un)" COMPOSE_PROJECT_NAME="$project"

first_log="$(DEPLOY_REF="$update_sha" scripts/deploy-production.sh)"
grep -q 'backup pre-deploy ignorado' <<<"$first_log"
curl -fsS http://127.0.0.1:3000/health/ready >/dev/null
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -c "insert into schema_migrations(version) values ('smoke-data') on conflict do nothing" >/dev/null

second_log="$(DEPLOY_REF="$update_sha" scripts/deploy-production.sh)"
grep -q 'Backup pre-deploy concluido antes das migrations' <<<"$second_log"
backup="$(find "$app_dir/backups" -type f -name 'leadfinder-*.dump' -size +0c -print -quit)"
[[ -n "$backup" ]]
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -Atc "select count(*) from schema_migrations where version='smoke-data'" | grep -qx 1

sleep 1
if DEPLOY_TEST_FORCE_FAILURE=true DEPLOY_REF="$failure_sha" scripts/deploy-production.sh >/tmp/deploy-rollback.log 2>&1; then exit 1; fi
[[ "$(git rev-parse HEAD)" == "$update_sha" ]]

export COMPOSE_PROJECT_NAME="${project}public" API_DOMAIN=localhost ACME_EMAIL=test@example.invalid CADDYFILE_PATH=./deploy/Caddyfile.test
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml up -d --build postgres api worker caddy
curl --retry 30 --retry-delay 2 --retry-all-errors -fsS http://127.0.0.1:18080/health/ready >/dev/null
[[ -z "$(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml port api 3000 2>/dev/null || true)" ]]
[[ -z "$(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml port postgres 5432 2>/dev/null || true)" ]]
! grep -q n8n deploy/Caddyfile.api.example
docker run --rm -e API_DOMAIN=api.example.com -e ACME_EMAIL=test@example.com -v "$app_dir/deploy/Caddyfile.api.example:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile
docker run --rm -e API_DOMAIN=api.example.com -e N8N_DOMAIN=automation.example.com -e ACME_EMAIL=test@example.com -v "$app_dir/deploy/Caddyfile.api-n8n.example:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile
printf '[smoke] first deploy, update backup, persistence, tunnel, public and rollback passed\n'
