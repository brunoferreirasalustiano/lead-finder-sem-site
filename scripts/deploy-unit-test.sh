#!/usr/bin/env bash
set -Eeuo pipefail
LOG_PREFIX='[test]'
# shellcheck source=lib/deploy-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-common.sh"
temporary="$(mktemp -d)"
trap 'rm -rf -- "$temporary"' EXIT

empty="$temporary/empty"
mkdir "$empty"
assert_clone_target_safe "$empty"
touch "$empty/unrelated"
if (assert_clone_target_safe "$empty") >/dev/null 2>&1; then die 'Diretorio nao vazio deveria ser rejeitado.'; fi
mkdir "$empty/.git"
assert_clone_target_safe "$empty"
[[ -f "$empty/unrelated" ]] || die 'Repositorio existente foi alterado.'

events=()
record_start() { events+=(start); }
record_wait() { events+=("wait:$1"); [[ "${WAIT_FAIL:-false}" != true ]]; }
record_backup() { events+=(backup); [[ "${BACKUP_FAIL:-false}" != true ]]; }

events=(); perform_predeploy_backup '' record_start record_wait record_backup; [[ ${#events[@]} -eq 0 ]] || die 'Primeiro deploy nao deve tentar backup.'
events=(); perform_predeploy_backup db-id record_start record_wait record_backup; [[ "${events[*]}" == 'start wait:db-id backup' ]] || die 'Ordem de backup invalida.'
events=(); BACKUP_FAIL=true; if (perform_predeploy_backup db-id record_start record_wait record_backup) >/dev/null 2>&1; then die 'Falha de pg_dump deveria cancelar.'; fi; unset BACKUP_FAIL
events=(); WAIT_FAIL=true; if (perform_predeploy_backup db-id record_start record_wait record_backup) >/dev/null 2>&1; then die 'Banco nao saudavel deveria cancelar.'; fi; [[ "${events[*]}" == 'start wait:db-id' ]] || die 'Backup executado com banco parado.'; unset WAIT_FAIL
events=(); perform_predeploy_backup db-id record_start record_wait record_backup; events+=(migration); [[ "${events[*]}" == 'start wait:db-id backup migration' ]] || die 'Backup deve preceder migration.'

validate_backup_settings /opt/lead-finder /opt/lead-finder/backups 7
for bad in relative /opt/lead-finder/backups/../escape /tmp/backups; do
  if (validate_backup_settings /opt/lead-finder "$bad" 7) >/dev/null 2>&1; then die "BACKUP_DIR inseguro aceito: $bad"; fi
done
for bad in 0 366 abc; do
  if (validate_backup_settings /opt/lead-finder /opt/lead-finder/backups "$bad") >/dev/null 2>&1; then die "Retencao invalida aceita: $bad"; fi
done
validate_public_domain API_DOMAIN api.example.com
for bad in api.example.invalid DOMINIO_EXEMPLO example localhost; do
  if (validate_public_domain API_DOMAIN "$bad") >/dev/null 2>&1; then die "Dominio de marcador aceito: $bad"; fi
done
printf '[test] deploy unit tests passed\n'
