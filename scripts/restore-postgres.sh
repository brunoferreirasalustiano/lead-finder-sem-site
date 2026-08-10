#!/usr/bin/env bash
set -Eeuo pipefail
# A restore handles a live HMAC key in shell memory. Never allow xtrace to echo it.
set +x
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
export RESTORE_SUPPRESSION_MANIFEST_DIR="$BACKUP_DIR"

docker compose "${COMPOSE_FILES[@]}" exec -T postgres pg_restore --list < "${backup}" >/dev/null || die 'Arquivo nao e um dump custom valido.'
printf 'Esta operacao substituira objetos no PostgreSQL da stack. Digite RESTAURAR para continuar: ' >&2
read -r confirmation
[[ "${confirmation}" == RESTAURAR ]] || die 'Restauracao cancelada.'

docker compose "${COMPOSE_FILES[@]}" stop api worker
[[ ! -e "$manifest" ]] || die 'O manifesto de saida ja existe.'
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:export -- --output "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:validate -- --manifest "$manifest_container"

# Capture the live key only in this shell's memory. --silent guarantees stdout
# contains only the secret, and -T avoids a pseudo-TTY. The key is never placed
# in BACKUP_DIR, argv, Compose environment, the manifest, or Docker logs.
precontact_hmac_key="$(
  docker compose "${COMPOSE_FILES[@]}" run --rm -T restore-suppression \
    npm run --silent restore:suppression:key:export -- --manifest "$manifest_container"
)"
[[ "$precontact_hmac_key" =~ ^[0-9a-f]{64}$ ]] || die 'Falha ao capturar a chave HMAC de recovery em memoria.'

restore_status=0
docker compose "${COMPOSE_FILES[@]}" exec -T postgres sh -ceu 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' < "${backup}" || restore_status=$?
(( restore_status == 0 )) || die "pg_restore falhou com codigo ${restore_status}; API e worker permanecem parados."

# A true pre-0048 backup can contain migration-0041 permanent events without an
# immutable email identity. Before running 0048, bridge only events that have an
# exact event-fingerprint/reason/source/timestamp match in the live manifest.
# Unmatched or conflicting history fails closed before any migration runs.
builtin printf '%s\n' "$precontact_hmac_key" | \
  docker compose "${COMPOSE_FILES[@]}" run --rm -T restore-suppression \
    npm run --silent restore:suppression:legacy:prepare -- --manifest "$manifest_container"

docker compose "${COMPOSE_FILES[@]}" run --rm migrate

# Feed the key to the one-shot runner only through stdin. `builtin printf` keeps
# the secret out of a child-process argv; the Docker command receives no secret
# argument or environment variable. Discard the shell copy immediately after a
# successful rekey (or no-op when the pre-0048 bridge already installed it).
builtin printf '%s\n' "$precontact_hmac_key" | \
  docker compose "${COMPOSE_FILES[@]}" run --rm -T restore-suppression \
    npm run --silent restore:suppression:key:recover -- --manifest "$manifest_container"
precontact_hmac_key=''
unset precontact_hmac_key

docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:apply -- --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:apply -- --manifest "$manifest_container" --apply --actor "${RESTORE_SUPPRESSION_ACTOR:-restore-operator}"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run restore:suppression:verify -- --manifest "$manifest_container"
docker compose "${COMPOSE_FILES[@]}" run --rm restore-suppression npm run pilot:real:preflight -- --restore-suppression-only
if [[ "${RESTORE_RESUME_SERVICES:-false}" == true ]]; then
  docker compose "${COMPOSE_FILES[@]}" up -d api worker
  printf '[restore] RESTORE_SUPPRESSION_SAFE; retomada controlada concluida.\n'
else
  printf '[restore] RESTORE_SUPPRESSION_SAFE; API e worker permanecem parados ate liberacao operacional.\n'
fi
