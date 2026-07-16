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
SHADOW_MODE_ENABLED=false
DATABASE_URL=postgresql://leadfinder:smoke-only-password@postgres:5432/leadfinder
API_PORT=3000
API_AUTH_TOKEN=synthetic-deploy-smoke-api-token-0001
DEPLOY_MODE=tunnel
ENABLE_N8N=false
COLLECTION_EGRESS_ENABLED=false
OVERPASS_API_URL=
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
worker_stop_line="$(grep -n 'Parando worker antes das migrations' "$first_log_file" | head -n1 | cut -d: -f1)"
migration_line="$(grep -n 'Aplicando migrations sem worker ativo' "$first_log_file" | head -n1 | cut -d: -f1)"
[[ -n "$worker_stop_line" && -n "$migration_line" && "$worker_stop_line" -lt "$migration_line" ]]
echo '::endgroup::'

echo '::group::Tunnel readiness'
curl -fsS http://127.0.0.1:3000/health/ready >/dev/null
echo '::endgroup::'

echo '::group::Insert persistence probe'
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -c "insert into schema_migrations(version) values ('smoke-data') on conflict do nothing" >/dev/null
echo '::endgroup::'

echo '::group::Second deploy and pre-deploy backup'
sleep 1
second_log_file=/tmp/second-deploy.log
DEPLOY_REF="$update_sha" scripts/deploy-production.sh | tee "$second_log_file"
second_log="$(cat "$second_log_file")"
grep -q 'Backup pre-deploy concluido antes das migrations' <<<"$second_log"
backup="$(find "$app_dir/backups" -type f -name 'leadfinder-*.dump' -size +0c -print -quit)"
[[ -n "$backup" ]]
[[ -z "$(git status --porcelain)" ]]
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml exec -T postgres psql -U leadfinder -d leadfinder -Atc "select count(*) from schema_migrations where version='smoke-data'" | grep -qx 1
echo '::endgroup::'

compose_tunnel() {
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.tunnel.yml "$@"
}
schema_probe() {
  compose_tunnel exec -T postgres psql -U leadfinder -d leadfinder -Atc "select string_agg(version, ',' order by version) from schema_migrations"
}
worker_is_running() {
  local worker_id
  worker_id="$(compose_tunnel ps -q worker)"
  [[ -n "$worker_id" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$worker_id")" == true ]]
}
assert_expired_lease_reclaimable() {
  compose_tunnel exec -T api node --input-type=module -e '
    import { campaignOutbox, claimCampaignOutbox, completeCampaignOutbox, createDatabase } from "@lead-finder/database";
    const { db, close } = createDatabase(process.env.DATABASE_URL);
    const now = new Date("2100-01-01T00:00:00.000Z");
    try {
      const item = (await db.insert(campaignOutbox).values({
        aggregateType: "deploy-smoke", aggregateId: crypto.randomUUID(), eventType: "SIMULATED",
        payload: { deployRollback: true }, idempotencyKey: crypto.randomUUID(),
        payloadFingerprint: "f".repeat(64), availableAt: now,
      }).returning())[0];
      if (!item) throw new Error("deploy lease fixture was not created");
      const original = await claimCampaignOutbox(db, { workerId: "pre-rollback-worker", leaseMs: 1_000, maxAttempts: 3, now });
      const recovered = await claimCampaignOutbox(db, { workerId: "post-rollback-worker", leaseMs: 1_000, maxAttempts: 3, now: new Date(now.getTime() + 1_000) });
      if (!original || !recovered || original.id !== item.id || recovered.id !== item.id || recovered.generation !== original.generation + 1) {
        throw new Error("expired lease was not reclaimed after rollback");
      }
      if (await completeCampaignOutbox(db, original, new Date(now.getTime() + 1_000))) throw new Error("stale lease ACK was accepted");
      if (!(await completeCampaignOutbox(db, recovered, new Date(now.getTime() + 1_000)))) throw new Error("reclaimed lease was not completable");
    } finally { await close(); }
  '
}

echo '::group::Pre-migration interruption is idempotent'
before_schema="$(schema_probe)"
for run in $(seq 1 3); do
  set +e
  DEPLOY_REF='refs/heads/does-not-exist' scripts/deploy-production.sh >"/tmp/deploy-before-migration-${run}.log" 2>&1
  interruption_status=$?
  set -e
  [[ "$interruption_status" -ne 0 ]]
  [[ "$(git rev-parse HEAD)" == "$update_sha" ]]
  [[ "$(schema_probe)" == "$before_schema" ]]
  worker_is_running
done
echo '::endgroup::'

echo '::group::Post-migration rollback is repeatable'
for run in $(seq 1 3); do
  rollback_log_file="/tmp/deploy-rollback-${run}.log"
  sleep 1
  set +e
  DEPLOY_TEST_FORCE_FAILURE=true DEPLOY_REF="$failure_sha" scripts/deploy-production.sh 2>&1 | tee "$rollback_log_file"
  rollback_status=${PIPESTATUS[0]}
  set -e
  actual_rollback_sha="$(git rev-parse HEAD)"
  printf '[smoke] rollback run=%s status=%s expected_sha=%s actual_sha=%s\n' "$run" "$rollback_status" "$update_sha" "$actual_rollback_sha"
  [[ "$rollback_status" -ne 0 ]]
  [[ "$actual_rollback_sha" == "$update_sha" ]]
  grep -q 'Parando worker antes das migrations' "$rollback_log_file"
  grep -q 'Aplicando migrations sem worker ativo' "$rollback_log_file"
  grep -q 'Rollback de codigo executado' "$rollback_log_file"
  [[ "$(schema_probe)" == "$before_schema" ]]
  worker_is_running
  assert_expired_lease_reclaimable
done
echo '::endgroup::'

echo '::group::Public mode through local Caddy'
export COMPOSE_PROJECT_NAME="${project}public" API_DOMAIN=localhost ACME_EMAIL=test@example.invalid CADDYFILE_PATH=./deploy/Caddyfile.test
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml up -d postgres
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml -f deploy/docker-compose.public.yml -f deploy/docker-compose.public-test.yml run --rm migrate
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
anonymous_snapshot_status="$(curl -sS -o /tmp/anonymous-snapshot.json -w '%{http_code}' http://127.0.0.1:18080/internal/operational-snapshot)"
[[ "$anonymous_snapshot_status" == 401 ]]
curl -fsS -H 'Authorization: Bearer synthetic-deploy-smoke-api-token-0001' http://127.0.0.1:18080/internal/operational-snapshot >/dev/null
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
