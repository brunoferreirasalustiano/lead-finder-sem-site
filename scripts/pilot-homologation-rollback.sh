#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pilot-homologation-common.sh
source "${script_dir}/lib/pilot-homologation-common.sh"

config_file="${PILOT_HOMOLOGATION_ENV_FILE:-.env.homologation}"
mode="${1:---dry-run}"
[[ "$mode" == --dry-run || "$mode" == --prepare ]] || pilot_die 'Uso: scripts/pilot-homologation-rollback.sh [--dry-run|--prepare]'
pilot_require_homologation "$config_file"
evidence_dir="$(pilot_safe_absolute_directory "$(pilot_env_value "$config_file" PILOT_EVIDENCE_DIR)")"

if [[ "$mode" == --dry-run ]]; then
  printf '%s\n' '[pilot-homologation] rollback preparado; a politica proibe restauracao in-place automatica.'
  exit 0
fi

[[ "${PILOT_ROLLBACK_CONFIRMATION:-}" == PREPARE_HOMOLOGATION_ROLLBACK ]] || pilot_die 'Defina PILOT_ROLLBACK_CONFIRMATION=PREPARE_HOMOLOGATION_ROLLBACK para preparar rollback.'
trap 'status=$?; if (( status != 0 )); then pilot_write_evidence "$evidence_dir" rollback.json GATE_ROLLBACK FAIL; fi; exit "$status"' ERR
pilot_set_env_value "$config_file" PILOT_KILL_SWITCH_ENABLED true
pilot_compose "$config_file" stop api worker
pilot_write_evidence "$evidence_dir" rollback.json GATE_ROLLBACK PASS
printf '%s\n' '[pilot-homologation] rollback preparado: processamento congelado; valide backup/restore separado antes de qualquer restauracao autorizada.'
