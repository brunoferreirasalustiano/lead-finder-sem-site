# Lead Finder Sem Site

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

## Execução

```bash
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev:api
npm run dev:worker
```

Stack em containers:

```bash
docker compose up --build
docker compose --profile integration up -d n8n
```

## API

- `GET /health`
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
```

## Segurança e limitações

Consultas Overpass são montadas somente a partir de categorias permitidas. Há limites de payload, paginação, timeout, backoff limitado e tratamento de 429/502/504. O índice único `(osm_type, osm_id)` protege contra duplicidade concorrente.

O dado OSM pode estar incompleto ou desatualizado; “sem site cadastrado” não prova que a empresa não possui site. O status exige validação humana antes de qualquer uso comercial. Esta versão não envia mensagens, não valida existência externa de sites, não agenda cota diária global entre múltiplas réplicas e não inclui deploy Oracle.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada em produtos derivados.
