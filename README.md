# Lead Finder Sem Site

> Deploy manual na Oracle Cloud: consulte [`docs/ORACLE_DEPLOY.md`](docs/ORACLE_DEPLOY.md) para preparacao, HTTPS, tunel SSH, backup, restauracao e rollback.

Automação self-hosted para localizar empresas sem site cadastrado usando fontes gratuitas. A primeira integração usa OpenStreetMap e Overpass API; o projeto foi desenhado para uma VPS Oracle Cloud Always Free, sem depender de APIs pagas.

## Arquitetura

- `apps/api`: API REST Fastify; valida entradas, pagina leads, exporta CSV e enfileira coletas.
- `apps/worker`: consome jobs no PostgreSQL, consulta Overpass, normaliza, pontua e persiste leads.
- `packages/database`: schema Drizzle, repositórios, deduplicação e fila transacional.
- `packages/overpass-client`: categorias permitidas, construção segura da consulta, timeout e retry.
- `packages/lead-scoring`: regra pura e testável de pontuação.
- `packages/shared`: contratos, enums e schemas Zod compartilhados.
- `database/migrations`: SQL versionado.
- `n8n/workflows`: reservado para integrações futuras; n8n Community Edition usa profile opcional.

O PostgreSQL não publica porta no host. API e n8n escutam somente em `127.0.0.1` no Compose; use um reverse proxy com TLS em produção.

## Requisitos

- Node.js 22 e npm
- Docker com Docker Compose

## Configuração

```bash
cp .env.example .env
```

Defina `POSTGRES_PASSWORD` e ajuste `DATABASE_URL`. Os padrões funcionais são Campinas/SP/Brasil e limite máximo de 50 por coleta. Nenhuma credencial real acompanha o repositório.

Variáveis principais: `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `API_PORT`, `OVERPASS_URL`, `OVERPASS_TIMEOUT_MS`, `OVERPASS_MAX_RETRIES`, `WORKER_POLL_INTERVAL_MS` e `DAILY_LEAD_LIMIT`.

Variáveis numéricas são validadas na inicialização. Portas devem estar entre 1 e 65535; timeout Overpass entre 1 e 120 segundos; retries entre 0 e 10; polling entre 1 segundo e 1 hora; limite diário entre 1 e 10.000.

## Execução

```bash
npm install
docker compose up -d postgres
docker compose run --rm migrate
npm run dev:api
npm run dev:worker
```

Stack em containers:

```bash
docker compose up --build
docker compose --profile integration up -d n8n
```

As migrations possuem controle em `schema_migrations`; executar `docker compose run --rm migrate` novamente é seguro e informa que a versão já foi aplicada.

## API

- `GET /health`
- `GET /health/live` verifica o processo
- `GET /health/ready` verifica a conexão PostgreSQL
- `GET /leads?page=1&pageSize=20&status=SEM_SITE_CADASTRADO&category=oficinas&city=Campinas&minScore=30`
- `GET /leads/:id`
- `GET /leads/export.csv` (máximo de 100 linhas por exportação nesta versão)
- `POST /collect`

Exemplo de coleta:

```json
{ "city": "Campinas", "state": "SP", "country": "Brasil", "category": "oficinas", "limit": 50 }
```

Categorias: `oficinas`, `autoeletricas`, `saloes-de-beleza`, `barbearias`, `clinicas`, `consultorios`, `restaurantes`, `lanchonetes`, `empresas-de-seguranca` e `prestadores-de-servicos`.

## Qualidade

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
docker compose config
docker build -f apps/api/Dockerfile -t lead-finder-api:test .
docker build -f apps/worker/Dockerfile -t lead-finder-worker:test .
npm run test:integration
```

O teste de integração usa PostgreSQL real e um servidor Overpass mock local determinístico. Uma coleta contra a Overpass pública é opcional e não faz parte do critério de aprovação da CI.

O workflow manual `Operational smoke` executa a stack completa com Docker Compose. O input `run_live_overpass` é `false` por padrão; habilite-o apenas para uma coleta pública opcional após o mock determinístico passar.

## Operação

```bash
docker compose ps
docker compose logs --no-color --tail=100 api worker
docker compose stop api worker
docker compose down -v --remove-orphans
```

Diagnóstico: `live` com erro indica falha do processo; `ready` com HTTP 503 indica indisponibilidade do PostgreSQL. O healthcheck do worker confirma que seu processo principal continua ativo.

Backup e restauração:

```bash
docker compose exec -T postgres pg_dump -U leadfinder -d leadfinder -Fc > leadfinder.dump
docker compose exec -T postgres pg_restore -U leadfinder -d leadfinder --clean --if-exists < leadfinder.dump
```

Na Oracle VPS, instale Docker Engine/Compose, permita externamente apenas SSH e as portas do reverse proxy, mantenha PostgreSQL sem porta publicada, configure `.env` fora do Git e coloque TLS na frente da API/n8n. O deploy não é automatizado nesta etapa.

## Segurança e limitações

Consultas Overpass são montadas somente a partir de categorias permitidas. Há limites de payload, paginação, timeout, backoff limitado e tratamento de 429/502/504. O índice único `(osm_type, osm_id)` protege contra duplicidade concorrente.

O dado OSM pode estar incompleto ou desatualizado; “sem site cadastrado” não prova que a empresa não possui site. O status exige validação humana antes de qualquer uso comercial. Esta versão não envia mensagens, não valida existência externa de sites, não agenda cota diária global entre múltiplas réplicas e não inclui deploy Oracle.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada em produtos derivados.
