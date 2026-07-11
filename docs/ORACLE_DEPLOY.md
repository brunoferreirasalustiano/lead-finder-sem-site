# Deploy manual na Oracle Cloud

Este runbook prepara Ubuntu 22.04/24.04 para AMD64 ou ARM64. Nenhuma CI conecta na VPS. PostgreSQL, worker e n8n nunca publicam portas; API usa somente loopback no modo tunnel e Caddy e a unica entrada no modo public.

## 1. Instancia, VCN e SSH

Crie uma instancia Oracle Always Free e permita na VCN somente a porta SSH atual, TCP 80/443 e opcionalmente UDP 443. Nunca permita `5432`, `3000` ou `5678`. Gere chave exclusiva:

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/lead-finder-oracle
ssh -i ~/.ssh/lead-finder-oracle ubuntu@IP_DA_VPS
```

So desative login por senha depois de validar acesso por chave em outra sessao. Os scripts nao modificam SSH.

## 2. Setup e primeiro clone

Revise e execute o setup como root:

```bash
sudo DEPLOY_USER=leadfinder-deploy bash scripts/setup-oracle-vps.sh
```

O setup cria `/opt/lead-finder` vazio, sem `backups`, instala Docker/Compose, Git, UFW e Fail2ban e preserva qualquer repositorio existente. Diretorio nao vazio que nao seja repositorio e rejeitado sem remover dados. Depois instale uma deploy key somente leitura e clone:

```bash
sudo -u leadfinder-deploy git clone git@github.com:brunoferreirasalustiano/lead-finder-sem-site.git /opt/lead-finder
cd /opt/lead-finder
```

O clone funciona porque o destino permanece vazio. `backups` e criado pelo primeiro backup, depois do clone.

## 3. Ambiente seguro

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 48
openssl rand -hex 32
```

Substitua marcadores `GENERATE_*`. Use senha original em `POSTGRES_PASSWORD` e forma URL-encoded em `DATABASE_URL`. O parser operacional le somente chaves permitidas; nunca executa `source .env`. `BACKUP_DIR` deve permanecer dentro de `/opt/lead-finder/backups` e a retencao aceita 1 a 365 dias.

## 4. Modo tunnel, sem dominio

Defina:

```dotenv
DEPLOY_MODE=tunnel
ENABLE_N8N=false
```

Execute:

```bash
git fetch origin --tags
DEPLOY_REF=origin/main scripts/deploy-production.sh
ssh -N -L 3000:127.0.0.1:3000 leadfinder-deploy@IP_DA_VPS
curl http://127.0.0.1:3000/health/ready
```

O override `deploy/docker-compose.tunnel.yml` publica somente `127.0.0.1:3000`; Caddy e dominios nao sao exigidos nem iniciados.

## 5. Modo public com HTTPS

Configure DNS A/AAAA, copie um Caddyfile e ajuste `.env`:

```bash
cp deploy/Caddyfile.api.example deploy/Caddyfile
chmod 644 deploy/Caddyfile
```

```dotenv
DEPLOY_MODE=public
ENABLE_N8N=false
API_DOMAIN=api.seudominio.com
ACME_EMAIL=admin@seudominio.com
CADDYFILE_PATH=./deploy/Caddyfile
```

```bash
DEPLOY_REF=origin/main scripts/deploy-production.sh
```

O preflight rejeita `.invalid`, `DOMINIO_EXEMPLO`, marcadores e Caddyfile ausente. Somente 80/443 sao publicados. O healthcheck executa `caddy validate --config /etc/caddy/Caddyfile`.

## 6. n8n opcional

Use n8n somente no modo public:

```bash
cp deploy/Caddyfile.api-n8n.example deploy/Caddyfile
```

Defina `ENABLE_N8N=true`, `N8N_DOMAIN`, `N8N_ENCRYPTION_KEY` com pelo menos 32 caracteres e o Caddyfile acima. O script ativa o profile `n8n`. A configuracao API-only nao declara dominio nem upstream n8n.

## 7. Primeiro deploy e atualizacao

No primeiro deploy, sem container PostgreSQL anterior, o log registra:

```text
Primeiro deploy: nao existe banco anterior; backup pre-deploy ignorado.
```

Isso nao cria dump vazio. Em atualizacao, o script inicia o PostgreSQL anterior, aguarda healthcheck e exige `pg_dump -Fc` nao vazio antes de checkout, build ou migration. O log confirma:

```text
Backup pre-deploy concluido antes das migrations.
```

Falha ao iniciar, tornar saudavel ou gerar backup cancela a atualizacao.

## 8. Backup e restauracao

```bash
scripts/backup-postgres.sh
scripts/restore-postgres.sh /opt/lead-finder/backups/leadfinder-YYYYMMDDTHHMMSSZ.dump
```

Backups usam UTC, formato custom, modos 700/600 e retencao limitada. A restauracao aceita somente arquivos dentro de `BACKUP_DIR`, valida o catalogo e exige digitar `RESTAURAR`. Copie backups criptografados para outro dominio de falha.

## 9. Health, logs e operacao

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml ps
docker compose --env-file .env -f docker-compose.yml -f docker-compose.production.yml logs --tail=100 api worker
```

Logs `json-file` sao limitados. Monitore disco, CPU e memoria. Para desligar sem apagar dados use `down --remove-orphans`; nunca use `down -v` em producao.

## 10. Rollback

Em falha apos troca de versao, o script retorna ao SHA anterior, reconstrói e sobe os servicos. Migrations nao sao revertidas: mantenha schema backward-compatible. Restaurar dump pode perder dados posteriores ao backup e exige decisao manual.

## 11. Diagnostico

- Primeiro clone falha: confirme que `/opt/lead-finder` esta vazio; o setup nunca apaga conteudo.
- Primeiro deploy tenta backup: verifique containers antigos com `docker compose ps -a` e o nome do projeto.
- Backup falha: confirme saude do PostgreSQL, espaco, permissao e `BACKUP_DIR`.
- Tunnel inacessivel: confirme bind `127.0.0.1` e mantenha a sessao SSH aberta.
- Public falha: confira DNS, VCN/UFW, Caddyfile e logs do Caddy.
- ARM64: use imagem Ubuntu ARM64; CI constroi API/worker e verifica manifests PostgreSQL/Caddy/n8n para ambas arquiteturas.
- Rollback falha: nao remova volumes; inspecione SHA, containers e backup antes de nova tentativa.

## 12. Validacoes automatizadas

`CI` executa testes Node, Bash, Compose, Buildx AMD64/ARM64 e manifests. `Deployment smoke` usa diretorio e volumes descartaveis, mock sem Overpass publica, primeiro deploy tunnel, insercao de dado, segundo deploy com backup, persistencia, Caddy HTTP local e rollback. Nenhuma VPS ou registry e acessado.
