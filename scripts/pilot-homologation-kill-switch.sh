#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pilot-homologation-common.sh
source "${script_dir}/lib/pilot-homologation-common.sh"

config_file="${PILOT_HOMOLOGATION_ENV_FILE:-.env.homologation}"
command="${1:-status}"
pilot_require_homologation "$config_file"
evidence_dir="$(pilot_safe_absolute_directory "$(pilot_env_value "$config_file" PILOT_EVIDENCE_DIR)")"

case "$command" in
  status)
    printf 'PILOT_KILL_SWITCH_ENABLED=%s\n' "$(pilot_env_value "$config_file" PILOT_KILL_SWITCH_ENABLED)"
    ;;
  --dry-run)
    printf '%s\n' '[pilot-homologation] kill switch preparado; nenhum arquivo ou container foi alterado.'
    ;;
  engage)
    [[ "${PILOT_KILL_SWITCH_CONFIRMATION:-}" == ENGAGE_HOMOLOGATION_PILOT ]] || pilot_die 'Defina PILOT_KILL_SWITCH_CONFIRMATION=ENGAGE_HOMOLOGATION_PILOT para interromper.'
    trap 'status=$?; if (( status != 0 )); then pilot_write_evidence "$evidence_dir" kill-switch.json GATE_KILL_SWITCH FAIL; fi; exit "$status"' ERR
    pilot_set_env_value "$config_file" PILOT_KILL_SWITCH_ENABLED true
    pilot_compose "$config_file" stop api worker
    pilot_write_evidence "$evidence_dir" kill-switch.json GATE_KILL_SWITCH PASS
    printf '%s\n' '[pilot-homologation] piloto interrompido; API e worker parados e kill switch persistido.'
    ;;
  release)
    [[ "${PILOT_KILL_SWITCH_CONFIRMATION:-}" == RELEASE_HOMOLOGATION_PILOT ]] || pilot_die 'Defina PILOT_KILL_SWITCH_CONFIRMATION=RELEASE_HOMOLOGATION_PILOT para liberar.'
    pilot_set_env_value "$config_file" PILOT_KILL_SWITCH_ENABLED false
    printf '%s\n' '[pilot-homologation] kill switch liberado; nenhum servico foi iniciado automaticamente.'
    ;;
  *)
    pilot_die 'Uso: scripts/pilot-homologation-kill-switch.sh [status|--dry-run|engage|release]'
    ;;
esac
