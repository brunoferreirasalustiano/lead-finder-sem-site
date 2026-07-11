# Deploy manual na Oracle Cloud

Este runbook opera o Lead Finder em Ubuntu sem deploy automatico pela CI. PostgreSQL, API, worker e n8n permanecem privados; somente Caddy publica portas. Nunca publique `5432`, `3000` ou `5678` na VCN ou no UFW.

## 1. Criar a instancia

Crie uma instancia Oracle Cloud compativel com Always Free usando Ubuntu Server 22.04 ou 24.04 LTS. Na VCN permita somente a porta SSH atual (normalmente TCP 22, restrita ao seu IP), TCP 80/443 e, opcionalmente, UDP 443 para HTTP/3. Nao crie regras para PostgreSQL, API ou n8n. Monitore CPU, memoria e disco.

## 2. Conectar por SSH

Crie uma chave exclusiva, protegida por passphrase:

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/lead-finder-oracle
ssh -i ~/.ssh/lead-finder-oracle ubuntu@IP_DA_VPS
```

Mantenha login por senha ativo ate confirmar a chave em outra sessao. O projeto nao altera `sshd_config`; desabilitar senha e root login e uma etapa manual posterior.

## 3. Executar o setup

Transfira o script por canal autenticado, revise e execute:

```bash
sudo DEPLOY_USER=leadfinder-deploy bash scripts/setup-oracle-vps.sh
```

O script instala Docker pelo repositorio oficial, Compose, Git, curl, jq, UFW e Fail2ban; cria o usuario e `/opt/lead-finder`; permite somente SSH, HTTP e HTTPS. O grupo `docker` equivale operacionalmente a root: conceda acesso somente ao usuario de deploy.

Instale a chave autorizada e valide o novo login antes de alterar qualquer politica SSH.

## 4. Clonar o repositorio privado

Use uma deploy key somente leitura e exclusiva:

```bash
sudo -u leadfinder-deploy ssh-keygen -t ed25519 -a 100 -f /home/leadfinder-deploy/.ssh/lead-finder-repo
sudo -u leadfinder-deploy git clone git@github.com:brunoferreirasalustiano/lead-finder-sem-site.git /opt/lead-finder
cd /opt/lead-finder
git checkout main
```

Cadastre somente a chave publica como deploy key. Restrinja `~/.ssh`, `config` e `known_hosts` ao usuario de deploy.

## 5. Criar `.env`

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 48
openssl rand -hex 32
```

Substitua todos os marcadores `GENERATE_*`. Se a senha possuir caracteres reservados, use a forma URL-encoded em `DATABASE_URL`; `POSTGRES_PASSWORD` recebe o valor original. Nunca imprima `.env` em logs, tickets ou CI.

## 6. Configurar acesso

### Com dominio e HTTPS

Crie registros DNS A/AAAA para `api.seudominio` e, se usar n8n, `automacao.seudominio`. Depois:

```bash
cp deploy/Caddyfile.example deploy/Caddyfile
chmod 644 deploy/Caddyfile
```

Defina `API_DOMAIN`, `N8N_DOMAIN`, `ACME_EMAIL` e `CADDYFILE_PATH=./deploy/Caddyfile`. Caddy solicita e renova certificados quando DNS, portas 80/443 e horario estiverem corretos.

### Sem dominio, somente tunel SSH

Nao execute Caddy com dominios ficticios. Suba a stack interna e diagnostique via `docker compose exec`. Para acesso temporario por tunel, crie um override local nao versionado que vincule apenas `127.0.0.1:3000:3000`, então use:

```bash
ssh -N -L 3000:127.0.0.1:3000 leadfinder-deploy@IP_DA_VPS
```

Nunca vincule `0.0.0.0:3000`.

## 7. Validar Compose e executar migration

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml config --quiet
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml up -d postgres
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml run --rm migrate
```

As migrations sao idempotentes. Mudancas futuras devem ser backward-compatible: rollback retorna codigo e containers, nao o schema.

## 8. Primeiro deploy e atualizacoes

```bash
cd /opt/lead-finder
git fetch origin --tags
DEPLOY_REF=origin/main scripts/deploy-production.sh
```

O script exige usuario de deploy, arvore limpa, `.env` modo `600` e ref existente. Ele valida Compose, cria backup, usa o SHA alvo sem `reset --hard`, constroi imagens, migra, sobe a stack, aguarda healthcheck e testa readiness. Em falha, tenta reconstruir o SHA anterior. Prefira tags assinadas ou SHAs revisados.

## 9. Healthchecks, logs e diagnostico

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml ps
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1))"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 api worker caddy
```

Logs `json-file` usam `LOG_MAX_SIZE` e `LOG_MAX_FILES`. Monitore disco. Certificado falhando normalmente indica DNS/VCN/UFW; API unhealthy indica banco, URL ou migrations; worker parado exige conferir Overpass e fila; permissao Docker pode exigir nova sessao.

## 10. Backup e restauracao

```bash
scripts/backup-postgres.sh
scripts/restore-postgres.sh /opt/lead-finder/backups/leadfinder-YYYYMMDDTHHMMSSZ.dump
```

O backup usa `pg_dump -Fc`, UTC, modo `600`, nao sobrescreve e aplica retencao de `BACKUP_RETENTION_DAYS` (7 por padrao). Copie backups criptografados para outro local; o mesmo disco nao protege contra perda da VPS. A restauracao valida o catalogo e exige `RESTAURAR`. Teste restauracoes periodicamente.

Agende backup como usuario de deploy e configure logrotate para seu arquivo de log:

```cron
15 3 * * * cd /opt/lead-finder && /usr/bin/env bash scripts/backup-postgres.sh >> /var/log/lead-finder-backup.log 2>&1
```

## 11. Rollback

Escolha um SHA anterior validado e passe-o em `DEPLOY_REF`. Nao reverta migrations destrutivas automaticamente; restaure backup somente após avaliar perda de dados e compatibilidade.

## 12. n8n opcional

Defina chave exclusiva em `N8N_ENCRYPTION_KEY`, DNS e HTTPS. Depois:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml --profile n8n up -d n8n caddy
```

Proteja o administrador, habilite MFA quando disponivel, limite usuarios e nunca exponha `5678`.

## 13. Desligar sem apagar dados

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml stop
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml down --remove-orphans
```

Nao use `down -v`: os volumes contem PostgreSQL, Caddy e n8n.

## 14. Checklist operacional

- Chaves SSH exclusivas, com passphrase e menor privilegio.
- Login por senha desativado somente apos testar chave em sessao separada.
- Ubuntu, Docker e imagens atualizados regularmente.
- VCN e UFW permitem somente SSH, 80 e 443.
- `.env` modo `600`, fora do Git e dos logs.
- Portas 5432, 3000 e 5678 nunca publicadas diretamente.
- Backups testados, criptografados e fora da instancia.
- Logs rotacionados e disco monitorado.
- Grupo Docker limitado ao usuario de deploy.
- n8n ativado apenas quando necessario.
