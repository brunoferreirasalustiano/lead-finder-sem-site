#!/usr/bin/env bash

die() { printf '%s ERROR: %s\n' "${LOG_PREFIX:-[deploy]}" "$*" >&2; exit 1; }
log() { printf '%s %s\n' "${LOG_PREFIX:-[deploy]}" "$*"; }

read_env_value() {
  local key="$1" file="${2:-.env}" line value count
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die 'Nome de configuracao invalido.'
  [[ -f "$file" ]] || return 1
  count="$(grep -Ec "^[[:space:]]*${key}=" "$file" || true)"
  (( count <= 1 )) || die "${key} aparece mais de uma vez em ${file}."
  (( count == 1 )) || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$file")"
  value="${line#*=}"
  value="${value%$'\r'}"
  [[ "$value" != *'$('* && "$value" != *'`'* && "$value" != *$'\n'* ]] || die "Valor inseguro para ${key}."
  printf '%s' "$value"
}

config_value() {
  local key="$1" fallback="$2" value="${!key:-}"
  if [[ -z "$value" ]]; then value="$(read_env_value "$key" .env || true)"; fi
  printf '%s' "${value:-$fallback}"
}

validate_backup_settings() {
  local app_dir="$1" backup_dir="$2" retention="$3" root="${app_dir%/}/backups"
  [[ "$backup_dir" == /* ]] || die 'BACKUP_DIR deve ser absoluto.'
  [[ "$backup_dir" != *'/../'* && "$backup_dir" != */.. && "$backup_dir" != *'//'* ]] || die 'BACKUP_DIR contem path traversal.'
  case "$backup_dir" in "$root"|"$root"/*) ;; *) die "BACKUP_DIR deve permanecer dentro de ${root}." ;; esac
  [[ "$retention" =~ ^[0-9]+$ ]] && (( retention >= 1 && retention <= 365 )) || die 'BACKUP_RETENTION_DAYS deve estar entre 1 e 365.'
}

validate_public_domain() {
  local name="$1" value="$2"
  [[ "$value" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$ ]] || die "${name} deve ser um dominio DNS valido."
  [[ "${value,,}" != *.invalid && "${value^^}" != *EXEMPLO* && "${value^^}" != *GENERATE* ]] || die "${name} nao pode usar marcador de exemplo."
}

assert_clone_target_safe() {
  local directory="$1"
  [[ -d "$directory" ]] || return 0
  [[ -d "$directory/.git" ]] && return 0
  [[ -z "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "${directory} nao esta vazio; nada foi removido."
}

perform_predeploy_backup() {
  local container_id="$1" start_callback="$2" wait_callback="$3" backup_callback="$4"
  if [[ -z "$container_id" ]]; then
    log 'Primeiro deploy: nao existe banco anterior; backup pre-deploy ignorado.'
    return 0
  fi
  log 'Atualizacao: iniciando e aguardando PostgreSQL anterior antes do backup.'
  "$start_callback" || return $?
  "$wait_callback" "$container_id" || return $?
  "$backup_callback" || return $?
  log 'Backup pre-deploy concluido antes das migrations.'
}
