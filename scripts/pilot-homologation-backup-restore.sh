#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pilot-homologation-common.sh
source "${script_dir}/lib/pilot-homologation-common.sh"

config_file="${PILOT_HOMOLOGATION_ENV_FILE:-.env.homologation}"
mode="${1:---dry-run}"
[[ "$mode" == --dry-run || "$mode" == --execute ]] || pilot_die 'Uso: scripts/pilot-homologation-backup-restore.sh [--dry-run|--execute]'
pilot_require_homologation "$config_file"

backup_dir="$(pilot_safe_absolute_directory "$(pilot_env_value "$config_file" PILOT_BACKUP_DIR)")"
evidence_dir="$(pilot_safe_absolute_directory "$(pilot_env_value "$config_file" PILOT_EVIDENCE_DIR)")"
source_db="$(pilot_env_value "$config_file" POSTGRES_DB)"
restore_db="$(pilot_env_value "$config_file" PILOT_RESTORE_DB)"
postgres_user="$(pilot_env_value "$config_file" POSTGRES_USER)"
[[ "$source_db" == leadfinder_homologation && "$restore_db" == leadfinder_homologation_restore ]] || pilot_die 'Alvos de banco inesperados.'

if [[ "$mode" == --dry-run ]]; then
  printf '%s\n' '[pilot-homologation] backup/restore preparado; nenhum banco, container ou arquivo foi alterado.'
  exit 0
fi

[[ "${PILOT_BACKUP_RESTORE_CONFIRMATION:-}" == RESTORE_SYNTHETIC_HOMOLOGATION ]] || pilot_die 'Defina PILOT_BACKUP_RESTORE_CONFIRMATION=RESTORE_SYNTHETIC_HOMOLOGATION para executar.'
trap 'status=$?; if (( status != 0 )); then pilot_write_evidence "$evidence_dir" backup-restore.json GATE_BACKUP_RESTORE FAIL; fi; exit "$status"' ERR
umask 077
mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"
backup="${backup_dir}/leadfinder-homologation-$(date -u +'%Y%m%dT%H%M%SZ').dump"
temporary="${backup}.partial"
[[ ! -e "$backup" && ! -e "$temporary" ]] || pilot_die 'Ja existe um backup com este identificador; tente novamente no proximo segundo.'

pilot_compose "$config_file" exec -T postgres pg_dump -U "$postgres_user" -d "$source_db" -Fc > "$temporary"
[[ -s "$temporary" ]] || pilot_die 'pg_dump produziu arquivo vazio.'
pilot_compose "$config_file" exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv -- "$temporary" "$backup"
chmod 600 "$backup"

source_migrations="$(pilot_compose "$config_file" exec -T postgres psql -U "$postgres_user" -d "$source_db" -Atc 'select count(*) from schema_migrations')"
source_tables="$(pilot_compose "$config_file" exec -T postgres psql -U "$postgres_user" -d "$source_db" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
pilot_compose "$config_file" exec -T postgres dropdb -U "$postgres_user" --if-exists "$restore_db"
pilot_compose "$config_file" exec -T postgres createdb -U "$postgres_user" "$restore_db"
pilot_compose "$config_file" exec -T postgres pg_restore -U "$postgres_user" -d "$restore_db" --clean --if-exists --no-owner --no-privileges < "$backup"
restore_migrations="$(pilot_compose "$config_file" exec -T postgres psql -U "$postgres_user" -d "$restore_db" -Atc 'select count(*) from schema_migrations')"
restore_tables="$(pilot_compose "$config_file" exec -T postgres psql -U "$postgres_user" -d "$restore_db" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
[[ "$source_migrations" == "$restore_migrations" && "$source_tables" == "$restore_tables" ]] || pilot_die 'Integridade do restore falhou; o banco de origem nao foi alterado.'
pilot_write_evidence "$evidence_dir" backup-restore.json GATE_BACKUP_RESTORE PASS
printf '%s\n' '[pilot-homologation] backup e restore separado verificados sem restaurar o banco de origem.'
