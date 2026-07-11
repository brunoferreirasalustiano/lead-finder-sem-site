#!/usr/bin/env bash
set -Eeuo pipefail
source_dir="$(pwd -P)"
workspace="$(mktemp -d)"
app_dir="$workspace/lead-finder"
project="deploysmoke${RANDOM}"
cleanup() {
  echo '::group::Cleanup'
  if [[ -d "$app_dir" ]]; then
    cd "$app_dir"
    docker compose -p "$project" --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml down -v --remove-orphans >/dev/null 2>&1 || true
    docker compose -p "${project}public" --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf -- "$workspace"
  echo '::endgroup::'
}
trap cleanup EXIT

echo '::group::Disposable clone'
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
echo '::endgroup::'

echo '::group::First tunnel deploy'
first_log_file=/tmp/first-deploy.log
DEPLOY_REF="$update_sha" scripts/deploy-production.sh | tee "$first_log_file"
first_log="$(cat "$first_log_file")"
grep -q 'backup pre-deploy ignorado' <<<"$first_log"
echo '::endgroup::'

echo '::group::Tunnel readiness'
curl -fsS http://127.0.0.1:3000/health/ready >/dev/null
echo '::endgroup::'

echo '::group::Insert persistence probe'
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -c "insert into schema_migrations(version) values ('smoke-data') on conflict do nothing" >/dev/null
echo '::endgroup::'

echo '::group::Second deploy and pre-deploy backup'
second_log_file=/tmp/second-deploy.log
DEPLOY_REF="$update_sha" scripts/deploy-production.sh | tee "$second_log_file"
second_log="$(cat "$second_log_file")"
grep -q 'Backup pre-deploy concluido antes das migrations' <<<"$second_log"
backup="$(find "$app_dir/backups" -type f -name 'leadfinder-*.dump' -size +0c -print -quit)"
[[ -n "$backup" ]]
[[ -z "$(git status --porcelain)" ]]
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -Atc "select count(*) from schema_migrations where version='smoke-data'" | grep -qx 1
echo '::endgroup::'

echo '::group::Forced rollback'
sleep 1
rollback_log_file=/tmp/deploy-rollback.log
set +e
DEPLOY_TEST_FORCE_FAILURE=true DEPLOY_REF="$failure_sha" scripts/deploy-production.sh 2>&1 | tee "$rollback_log_file"
rollback_status=${PIPESTATUS[0]}
set -e
actual_rollback_sha="$(git rev-parse HEAD)"
printf '[smoke] rollback status=%s expected_sha=%s actual_sha=%s\n' "$rollback_status" "$update_sha" "$actual_rollback_sha"
[[ "$rollback_status" -ne 0 ]]
[[ "$actual_rollback_sha" == "$update_sha" ]]
grep -q 'Rollback de codigo executado' /tmp/deploy-rollback.log
echo '::endgroup::'

echo '::group::Public mode through local Caddy'
export COMPOSE_PROJECT_NAME="${project}public" API_DOMAIN=localhost ACME_EMAIL=test@example.invalid CADDYFILE_PATH=./deploy/Caddyfile.test
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml up -d --build postgres api worker caddy
public_ready=false
for _attempt in $(seq 1 30); do
  printf '[smoke] public readiness attempt %s/30\n' "$_attempt"
  if curl -fsS http://127.0.0.1:18080/health/ready >/dev/null; then
    public_ready=true
    printf '[smoke] public proxy is ready\n'
    break
  fi
  sleep 2
done
if [[ "$public_ready" != true ]]; then
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml ps
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml logs --no-color --tail=100 caddy api
  exit 1
fi
public_config="$(docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml config --format json)"
api_published_ports="$(jq '(.services.api.ports // []) | length' <<<"$public_config")"
postgres_published_ports="$(jq '(.services.postgres.ports // []) | length' <<<"$public_config")"
printf '[smoke] public API published ports: %s\n' "$api_published_ports"
printf '[smoke] public PostgreSQL published ports: %s\n' "$postgres_published_ports"
[[ "$api_published_ports" -eq 0 ]]
[[ "$postgres_published_ports" -eq 0 ]]
printf '[smoke] checking that API-only Caddyfile has no n8n reference\n'
! grep -q n8n deploy/Caddyfile.api.example
echo '::endgroup::'

echo '::group::Caddyfile validation'
docker run --rm -e API_DOMAIN=api.example.com -e ACME_EMAIL=test@example.com -v "$app_dir/deploy/Caddyfile.api.example:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile
docker run --rm -e API_DOMAIN=api.example.com -e N8N_DOMAIN=automation.example.com -e ACME_EMAIL=test@example.com -v "$app_dir/deploy/Caddyfile.api-n8n.example:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile
echo '::endgroup::'
printf '[smoke] first deploy, update backup, persistence, tunnel, public and rollback passed\n'
