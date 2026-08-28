# Lead Finder Brasil

CRM de prospecção em evolução para uma plataforma brasileira de inteligência comercial, descoberta ativa, qualificação assistida por IA e encaminhamento humano de oportunidades.

A busca de empresas com indícios de ausência de site e a oferta de landing pages constituem a primeira vertical experimental do produto. A visão futura inclui múltiplos nichos, cobertura nacional e prospecção conversacional governada.

> **Estado atual:** a homologação permanece fail-closed e sem autorização para produção comercial automática. Houve operação manual de e-mail fora do runtime; esses envios exigem reconciliação com os registros internos antes de qualquer piloto repetível.

- [Estado operacional consolidado](docs/current-operational-status.md)
- [Escopo futuro do produto](docs/FUTURE_PRODUCT_SCOPE.md)
- [Índice de documentação](docs/README.md)
- [Auditoria de segurança e privacidade](docs/security-privacy-audit.md)
- [Threat model operacional](docs/operational-threat-model.md)
- [Roadmap estratégico](docs/PRODUCT_ROADMAP.md)

## Estado operacional atual

**Snapshot da auditoria:** 6 de agosto de 2026  
**Branch oficial de produção:** `main`  
**Branch de homologação:** `hml/render-supabase-plan-b`  
**HEAD da HML observado no snapshot:** `66ef53e464bc8aa06ab67d2cf947087b4c2903bd`  
**Render live verificado:** `05a2696cf03ada5bc4d71cd0a94cd9dfd6bb3dec`  
**Estado comercial:** `REAL_MANUAL_PILOT=RECONCILIATION_REQUIRED`  
**Produção comercial automática:** `AUTOMATED_COMMERCIAL_PRODUCTION=NO_GO`

Os SHAs e as contagens abaixo são evidências históricas do snapshot de 6 de agosto de 2026. Eles não devem ser interpretados como ponteiros dinâmicos após novos commits, merges ou deploys.

### Divergência Git

Na revalidação de 6 de agosto de 2026, a HML estava `153` commits à frente e `1` commit atrás da `main`. As branches permanecem divergentes. O estado operacional recente não pode ser atribuído à `main` sem verificação por capacidade, branch e SHA.

### Ambiente hospedado

- o serviço Render `lead-finder-api-hml` existe e usa `hml/render-supabase-plan-b`;
- o auto-deploy está desligado;
- o health check configurado é `/health/ready`;
- o último deploy Render verificado estava `live` no SHA `05a2696cf03ada5bc4d71cd0a94cd9dfd6bb3dec`;
- esse SHA live é anterior ao HEAD da HML observado no snapshot e não comprova implantação da PR #209;
- o serviço `lead-finder-email-test-runner-once` continua implantado, porém seu comando é inerte por padrão e exige ativação explícita para executar;
- o projeto Supabase `lead-finder-brasil-homologacao` estava `ACTIVE_HEALTHY` em PostgreSQL `17.6` na última auditoria autenticada;
- `public.schema_migrations` e `supabase_migrations.schema_migrations` coexistem e devem ser reconciliados antes de novas migrations;
- `public.schema_migrations` continha a sequência local até `0027`;
- migrations equivalentes a `0035`–`0040` constavam no registry nativo do Supabase;
- `0041_email_delivery_suppression.sql` está integrada à HML, mas sua aplicação hospedada não foi revalidada após o merge;
- `0042_restricted_manual_email_consumer.sql` permanece somente na PR #215 e não está integrada à HML.

A presença de uma migration no código ou em uma PR não comprova aplicação no ambiente hospedado.

### Pull requests relevantes

- **PR #209 — supressão de entrega:** integrada à HML em 6 de agosto de 2026 pelo merge commit `66ef53e464bc8aa06ab67d2cf947087b4c2903bd`. A migration `0041_email_delivery_suppression.sql` está em `hml/render-supabase-plan-b`; a aplicação no Supabase e a reconciliação dos bounces continuam `NOT_VERIFIED`/pendentes.
- **PR #215 — consumidor Gmail restrito:** aberta e Ready for Review no snapshot, HEAD `7b480fad251cfcf8c263fa3522b192e13e22105e`, `25` commits à frente e `10` atrás da HML naquele momento. O deployment smoke no HEAD passou, mas a CI permanecia falhando. O corpo da PR ainda dizia que ela deveria permanecer Draft, em contradição com o estado observado. A migration `0042` e o consumidor Gmail não estavam integrados nem hospedados.
- **PR #216 — reconciliação documental:** permanece Draft e deve ser atualizada e validada antes de merge.

### E-mail manual e runtime

A auditoria somente leitura do Gmail encontrou, no intervalo iniciado em 3 de agosto de 2026:

- `76` mensagens comerciais enviadas com o padrão de assunto do piloto;
- `9` notificações agregadas de falha de entrega;
- `0` respostas na busca específica pelo mesmo padrão de assunto.

Essas contagens comprovam atividade manual na conta operacional, não envio registrado ou autorizado pelo runtime. Destinatários, assuntos completos e conteúdo não fazem parte desta documentação.

Distinções obrigatórias:

- **envio manual pelo operador:** ocorreu fora do runtime e precisa ser reconciliado;
- **envio registrado pelo runtime:** não foi comprovado para essas mensagens;
- **envio automático:** permanece desabilitado e não autorizado.

### Matriz de capacidades

| Capacidade | Código | HML | Main | Hospedado | Autorizado para uso real |
|---|---|---|---|---|---|
| Descoberta e qualificação | `IMPLEMENTED` | `IN_HML` | `IN_MAIN` | `DEPLOYED` | `DISABLED` |
| CRM e revisão humana | `IMPLEMENTED` | `IN_HML` | `IN_MAIN` | `DEPLOYED` | `BLOCKED` |
| Template/preparação de e-mail manual | `IMPLEMENTED` | `IN_HML` | `NOT_VERIFIED` | `NOT_VERIFIED` | `BLOCKED` |
| Consumidor Gmail restrito | `IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `NOT_IMPLEMENTED` | `BLOCKED` |
| Supressão permanente de bounce/contato inválido | `IMPLEMENTED` | `IN_HML` | `NOT_IMPLEMENTED` | `NOT_VERIFIED` | `BLOCKED` |
| WhatsApp Cloud API de HML | `IMPLEMENTED` | `IN_HML` | `NOT_VERIFIED` | `DEPLOYED` | `DISABLED` |
| Envio comercial automático | `DISABLED` | `DISABLED` | `DISABLED` | `DISABLED` | `DISABLED` |

`IMPLEMENTED` pode significar código presente em uma PR aberta. `IN_HML` exige integração na branch de homologação. `DEPLOYED` exige evidência do ambiente hospedado no SHA correspondente.

### Segurança e performance

A postura atual continua conservadora:

```text
COLLECTION_EGRESS_ENABLED=false
DRY_RUN=true
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
REAL_PROVIDER_CONFIGURED=false
```

Na última auditoria autenticada do Supabase, as `57` tabelas públicas observadas estavam com RLS habilitado. Existiam `11` policies restritas à role interna `lead_finder_api_runtime`; não foram encontrados grants de tabela para `PUBLIC`, `anon` ou `authenticated`. Portanto, a afirmação histórica de “zero policies” não é mais verdadeira, embora a Data API pública continue sem grants para essas roles.

A consulta estrutural encontrou `28` foreign keys potencialmente sem índice líder. Isso é dívida de performance a revisar antes de escala; não é, isoladamente, bloqueador para um piloto pequeno.

A auditoria de código e CI encontrou controles de idempotência, append-only, locks, sanitização e defaults fail-closed. Não houve evidência de secret real versionado na inspeção direcionada. Isso não substitui auditoria contínua de logs hospedados nem prova absoluta de ausência de PII em toda execução.

### Gates obrigatórios

Antes de declarar o primeiro piloto real controlado, auditável e repetível:

1. reconciliar as `76` mensagens manuais e as `9` falhas com o CRM/runtime sem copiar PII para artefatos públicos;
2. revalidar e, mediante autorização separada, aplicar a migration `0041` no ambiente hospedado;
3. registrar as supressões definitivas e comprovar que os gates bloqueiam os contatos afetados;
4. atualizar a PR #215 sobre a HML atual, corrigir a CI e alinhar seu estado Draft/Ready;
5. aplicar a migration `0042` somente após backup, preflight, autorização separada e CI verde no SHA exato;
6. comprovar o consumidor Gmail com privilégio mínimo, idempotência, kill switch e ausência de retry ambíguo;
7. validar opt-out, hard bounce e contato inválido antes de cada nova preparação;
8. executar um lote pequeno com aprovação humana individual e relatório agregado;
9. emitir um GO/NO-GO explícito separado.

Estados preservados:

```text
AUTOMATED_COMMERCIAL_PRODUCTION=NO_GO
REAL_MANUAL_PILOT=RECONCILIATION_REQUIRED
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
```

## Regra fundamental

`SEM_SITE_CADASTRADO` significa apenas que a fonte consultada não informou um site. Isso **não comprova** que a empresa não possui site.

Nenhuma abordagem comercial pode ocorrer antes de:

1. validar a empresa e o indício de ausência de site;
2. validar o contato e sua origem;
3. confirmar ausência de duplicidade, bloqueio, bounce impeditivo, `NAO_CONTATAR` e opt-out aplicável;
4. registrar revisão humana;
5. usar template aprovado;
6. reservar idempotência e limites;
7. confirmar que todos os efeitos externos permitidos estão explicitamente habilitados.

Qualquer dúvida resulta em `REVISAO_HUMANA` e impede a ação.

## Estado do projeto

### Implementado

- descoberta por OpenStreetMap/Overpass, com egress desligado por padrão;
- normalização, scoring, deduplicação e qualificação conservadora;
- contatos versionados e associados ao lead;
- CRM, oportunidades, tarefas, notas, tags e timeline;
- campanhas, templates, recipients, attempts, eventos e outbox;
- leasing, concorrência, liderança, limites, dead-letter e recuperação auditável;
- revisão humana, opt-out, bloqueios e estados de piloto;
- supressão persistente e fail-closed de hard bounce, contato inválido, opt-out e complaint integrada à HML;
- autenticação Bearer e matriz explícita de permissões;
- logs e evidências sanitizados;
- Docker Compose, imagens API/worker, smoke e CI com PostgreSQL;
- perfis `oracle-vps` e `supabase-render`;
- runbooks de piloto, WhatsApp, IA, backup, restore e failover.

### Pendente ou bloqueado

- reconciliação da operação manual de e-mail e das falhas de entrega;
- revalidação/aplicação hospedada da migration `0041`;
- atualização, integração e validação do consumidor Gmail da PR #215;
- confirmação externa automatizada de ausência real de site;
- enriquecimento externo de contatos e adaptador oficial de Google Places;
- WhatsApp Business Cloud API para uso real;
- OpenAI em shadow mode;
- propostas comerciais/PDF e dashboard operacional;
- automações completas no n8n;
- validação do perfil Oracle em VPS real;
- produção multi-tenant e escala comercial automática.

## Arquitetura

```text
Descoberta -> Normalização -> Deduplicação -> Validação -> Qualificação
-> CRM -> Revisão humana -> Preparação controlada
-> Resultado manual/simulado -> Métricas -> Reconciliação
```

Componentes principais:

- `apps/api` — API Fastify, autenticação, autorização e rotas operacionais;
- `apps/worker` — processamento de jobs e outbox;
- `packages/database` — schema, repositórios, migrations, idempotência e filas;
- `packages/batch-processor` — processamento limitado e coordenado;
- `packages/overpass-client` — consultas seguras, timeout e retry;
- `packages/lead-scoring` — regras de pontuação;
- `packages/shared` — contratos e schemas Zod;
- `database/migrations` — SQL incremental e versionado;
- `database/security` — roles e grants de privilégio mínimo;
- `deploy` — descritores Oracle, Supabase e Caddy;
- `scripts` — migrations, gates, backup, restore, rollback e smoke;
- `n8n/workflows` — automações opcionais, ainda não autorizadas para campanhas reais.

## Perfis de implantação

### Supabase + Render

Perfil de homologação e Plano B:

- API Node.js no Render;
- PostgreSQL no Supabase;
- conexão server-side por `DATABASE_URL`;
- TLS obrigatório;
- pool reduzido;
- Edge Function e Cron opcionais;
- dry-run, egress e providers externos bloqueados por padrão.

Documentos:

- [Plano B Supabase + Render](docs/infrastructure/supabase-render-plan-b.md)
- [Scheduler Daily-6 via Supabase](docs/runbooks/daily6-supabase-scheduler.md)
- [Runbook de implantação](docs/runbooks/supabase-render-deployment.md)
- [Operação com dois perfis](docs/runbooks/dual-deployment-operations.md)
- [Segurança da Data API](docs/supabase-data-api-security.md)

### Oracle VPS

Perfil self-hosted com PostgreSQL, API e worker em redes privadas, Caddy, backup, restore e rollback. A validação em VPS real continua pendente.

Documento: [Runbook Oracle](docs/ORACLE_DEPLOY.md).

## Piloto manual controlado

O piloto documentado não é disparo automatizado. Cada destinatário exige triagem e aprovação individual.

Regras mínimas:

- lote pequeno e delimitado;
- contato empresarial público pertinente;
- confirmação atual de ausência de site oficial próprio;
- ausência de contato anterior incompatível;
- ausência de bounce, complaint, opt-out ou bloqueio;
- sem CC, BCC, anexo, pixel ou tracking;
- nenhum follow-up automático;
- nenhum retry após falha, timeout ou resultado ambíguo;
- opt-out aplicado imediatamente;
- resultado reconciliado sem expor PII.

O template `pilot-email-first-contact@v2` não autoriza envio por si só.

Documentos:

- [Pacote operacional](docs/pilot-manual-operations-pack.md)
- [Template manual de e-mail v2](docs/pilot-real-manual-email-v2.md)
- [Runbook do ciclo controlado](docs/pilot-real-controlled-runbook.md)
- [Matriz de prontidão](docs/commercial-readiness-matrix.md)

## WhatsApp e IA

- WhatsApp Web automatizado e bibliotecas de sessão por QR Code são proibidos;
- uso real futuro deve ocorrer pela Cloud API oficial;
- IA pode gerar rascunho ou classificação, nunca autorizar envio;
- sandbox usa somente ativos e destinos controlados;
- tokens e payloads integrais não entram em logs ou Git.

## Requisitos e execução local

- Node.js 22 ou superior;
- npm;
- Docker Engine e Docker Compose para integração completa;
- PostgreSQL real pelo Compose ou CI.

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

Integração completa:

```bash
docker compose up -d postgres
docker compose run --rm migrate
npm run test:integration
```

Nunca copie secrets de homologação ou produção para arquivos locais versionados.

## API e autorização

Rotas públicas:

- `GET /health/live`
- `GET /health`
- `GET /health/ready`

As demais rotas exigem `Authorization: Bearer <API_AUTH_TOKEN>` e permissões por allowlist. A API permanece single-operator; multi-tenant exige isolamento e autorização por objeto.

## Qualidade e CI

Gates obrigatórios incluem typecheck, lint, testes, cobertura, build, audit de dependências, integração PostgreSQL, migration compatibility, RLS, restore, Docker e multiarch quando aplicável.

Falha de infraestrutura ou de migration deve ser registrada como `BLOCKED`, nunca ocultada para produzir um estado verde.

## Segurança operacional

- nenhum secret no Git;
- logs sem PII ou payload bruto;
- autenticação e autorização no aplicativo;
- opt-out global e por canal;
- `NAO_CONTATAR` com reativação explícita e auditada;
- idempotência antes de efeitos externos;
- retry apenas para falhas transitórias classificadas;
- provider real desligado por padrão;
- backup/restore com reconciliação de supressões;
- nenhuma automação de navegador para WhatsApp.

## Limitações atuais

- dados OSM podem estar incompletos ou desatualizados;
- ausência de site na fonte não confirma ausência real;
- os envios manuais observados não estão automaticamente auditados pelo runtime;
- a supressão persistente está integrada à HML, mas sua aplicação hospedada ainda não foi revalidada;
- o consumidor Gmail restrito ainda não está integrado à HML;
- produção comercial automática permanece desabilitada;
- não existe homologação Oracle real;
- o projeto não está pronto para multi-tenant ou escala de 60 mensagens diárias.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada.

## Manutenção documental

Toda PR que alterar arquitetura, flags, ambiente, provider, segurança ou estado operacional deve revisar:

1. [estado operacional consolidado](docs/current-operational-status.md);
2. este `README.md`;
3. [índice de documentação](docs/README.md);
4. runbooks e registros de risco afetados;
5. issue, PR e evidências de CI correspondentes.

Nunca documentar publicamente tokens, senhas, connection strings, PII de leads, mensagens integrais ou payloads brutos.
