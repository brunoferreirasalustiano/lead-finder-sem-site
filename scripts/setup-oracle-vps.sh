#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_USER="${DEPLOY_USER:-leadfinder-deploy}"
APP_DIR="${APP_DIR:-/opt/lead-finder}"
SSH_SERVICE="${SSH_SERVICE:-OpenSSH}"
LOG_PREFIX='[setup]'
# shellcheck source=lib/deploy-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-common.sh"

[[ "${EUID}" -eq 0 ]] || die 'Execute como root (use sudo).'
[[ -r /etc/os-release ]] || die 'Nao foi possivel identificar o sistema operacional.'
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu ]] || die 'Este script suporta somente Ubuntu Server.'
case "${VERSION_ID:-}" in 22.04|24.04) ;; *) die "Ubuntu ${VERSION_ID:-desconhecido} nao suportado; use 22.04 ou 24.04 LTS." ;; esac
[[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'DEPLOY_USER invalido.'

export DEBIAN_FRONTEND=noninteractive
log 'Atualizando pacotes e instalando dependencias basicas.'
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git jq ufw fail2ban gnupg

if ! command -v docker >/dev/null 2>&1; then
  log 'Configurando o repositorio oficial do Docker.'
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  arch="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$arch" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update
fi
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  log "Criando usuario de deploy ${DEPLOY_USER}."
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"
assert_clone_target_safe "${APP_DIR}"
if [[ ! -d "${APP_DIR}" ]]; then
  install -d -m 0750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}"
elif [[ ! -d "${APP_DIR}/.git" ]]; then
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
  chmod 0750 "${APP_DIR}"
else
  log "Repositorio existente preservado em ${APP_DIR}."
fi

log 'Configurando firewall sem alterar a porta ou a autenticacao SSH.'
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_SERVICE}" || ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

systemctl enable --now docker
systemctl enable --now fail2ban

cat <<SUMMARY

Preparacao concluida.
- Usuario de deploy: ${DEPLOY_USER}
- Diretorio da aplicacao: ${APP_DIR}
- Portas permitidas no UFW: SSH atual, 80/tcp, 443/tcp e 443/udp
- Docker e Fail2ban: habilitados

Proximos passos manuais:
1. Instale uma chave SSH exclusiva em /home/${DEPLOY_USER}/.ssh/authorized_keys.
2. Valide o login por chave em outra sessao antes de desabilitar senhas.
3. Clone o repositorio privado em ${APP_DIR} como ${DEPLOY_USER}.
4. Crie ${APP_DIR}/.env com permissao 600; este script nunca solicita secrets.
SUMMARY
