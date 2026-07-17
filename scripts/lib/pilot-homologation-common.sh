#!/usr/bin/env bash

pilot_die() {
  printf '%s\n' "[pilot-homologation] $*" >&2
  exit 1
}

pilot_env_value() {
  local file="$1" key="$2" value count
  [[ -f "$file" && -r "$file" ]] || pilot_die 'Arquivo de homologacao inexistente ou ilegivel.'
  count="$(awk -v prefix="${key}=" 'index($0, prefix) == 1 { count += 1; value = substr($0, length(prefix) + 1) } END { print count + 0 }' "$file")"
  [[ "$count" == 1 ]] || pilot_die "A variavel ${key} deve aparecer exatamente uma vez."
  value="$(awk -v prefix="${key}=" 'index($0, prefix) == 1 { print substr($0, length(prefix) + 1); exit }' "$file")"
  [[ -n "$value" ]] || pilot_die "A variavel ${key} nao pode ser vazia."
  printf '%s' "$value"
}

pilot_require_homologation() {
  local file="$1" database restore guard marker
  marker="$(pilot_env_value "$file" PILOT_HOMOLOGATION)"
  database="$(pilot_env_value "$file" POSTGRES_DB)"
  restore="$(pilot_env_value "$file" PILOT_RESTORE_DB)"
  guard="$(pilot_env_value "$file" PILOT_DATABASE_GUARD)"
  [[ "$marker" == true ]] || pilot_die 'PILOT_HOMOLOGATION=true e obrigatorio.'
  [[ "$database" == leadfinder_homologation ]] || pilot_die 'POSTGRES_DB de homologacao obrigatorio.'
  [[ "$guard" == leadfinder_homologation ]] || pilot_die 'PILOT_DATABASE_GUARD invalido.'
  [[ "$restore" == leadfinder_homologation_restore && "$restore" != "$database" ]] || pilot_die 'PILOT_RESTORE_DB deve ser separado e fixo.'
  [[ "$(pilot_env_value "$file" SHADOW_MODE_ENABLED)" == true ]] || pilot_die 'SHADOW_MODE_ENABLED=true e obrigatorio para homologacao.'
  [[ "$(pilot_env_value "$file" COLLECTION_EGRESS_ENABLED)" == false ]] || pilot_die 'COLLECTION_EGRESS_ENABLED deve ser false.'
  [[ "$(pilot_env_value "$file" REAL_PROVIDER_CONFIGURED)" == false ]] || pilot_die 'REAL_PROVIDER_CONFIGURED deve ser false.'
}

pilot_safe_absolute_directory() {
  local value="$1" resolved
  [[ "$value" == /* ]] || pilot_die 'Diretorio deve ser absoluto.'
  resolved="$(realpath -m -- "$value")"
  [[ "$resolved" != / ]] || pilot_die 'Diretorio raiz nao e permitido.'
  printf '%s' "$resolved"
}

pilot_compose() {
  local file="${1:-}"
  [[ -n "$file" && -f "$file" && -r "$file" ]] || pilot_die 'Arquivo de homologacao inexistente ou ilegivel.'
  shift
  (( $# > 0 )) || pilot_die 'Comando Docker Compose obrigatorio.'
  docker compose --env-file "$file" -f docker-compose.yml -f docker-compose.homologation.yml "$@"
}

pilot_write_evidence() {
  local directory="$1" file="$2" gate="$3" status="$4"
  mkdir -p -- "$directory"
  chmod 700 "$directory"
  umask 077
  printf '{\n  "schemaVersion": "1.0",\n  "gate": "%s",\n  "status": "%s"\n}\n' "$gate" "$status" > "${directory}/${file}"
  chmod 600 "${directory}/${file}"
}

pilot_set_env_value() {
  local file="$1" key="$2" value="$3" temporary
  temporary="$(mktemp "${file}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 { print key "=" value; found += 1; next }
    { print }
    END { if (found == 0) print key "=" value; if (found > 1) exit 1 }
  ' "$file" > "$temporary" || { rm -f -- "$temporary"; pilot_die "Nao foi possivel atualizar ${key}."; }
  chmod 600 "$temporary"
  mv -- "$temporary" "$file"
}
