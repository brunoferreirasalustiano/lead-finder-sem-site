# Lead Finder CRM — Prospecção de empresas sem site

Segurança operacional: [auditoria de segurança e privacidade](docs/security-privacy-audit.md), [threat model](docs/operational-threat-model.md), [retenção e exclusão](docs/data-retention-and-deletion.md), [runtime shadow](docs/shadow-mode-runtime.md), [checklist do piloto](docs/pilot-shadow-mode-checklist.md) e [matriz de prontidão](docs/commercial-readiness-matrix.md).

> Documento oficial de visão, arquitetura, execução, roadmap, critérios de aceite e evidências de teste.
>
> Ambiente oficial: **VPS Oracle Cloud**, com Ubuntu, Docker Compose, PostgreSQL, API, worker, Caddy e n8n opcional.

O projeto localiza empresas com indícios de ausência de site, qualifica os leads e organiza a prospecção comercial para oferta de landing pages e sites institucionais. A evolução planejada transforma o coletor atual em um CRM de prospecção multicanal com e-mail, WhatsApp, follow-ups, propostas e métricas.

## Regra fundamental do produto

`SEM_SITE_CADASTRADO` significa apenas que a fonte consultada não informou um site. Isso **não comprova** que a empresa não possui site.

Nenhuma abordagem comercial pode ser enviada antes de:

1. validar a empresa e o indício de ausência de site;
2. validar o contato e sua origem;
3. confirmar que o lead não está bloqueado ou marcado como `NAO_CONTATAR`;
4. aprovar a primeira mensagem;
5. reservar a idempotência e o limite do canal.

## Objetivo final

```text
Descoberta -> Normalização -> Deduplicação -> Validação -> Qualificação
-> CRM -> Aprovação -> Campanha -> E-mail/WhatsApp -> Resposta
-> Follow-up -> Proposta -> Ganho/Perdido -> Métricas
```

## Estado atual

### Implementado

- [x] coleta via OpenStreetMap/Overpass;
- [x] categorias permitidas e consultas protegidas;
- [x] normalização, scoring e deduplicação OSM;
- [x] PostgreSQL e migrations versionadas;
- [x] fila transacional e worker;
- [x] API REST, paginação, detalhes e CSV;
- [x] testes unitários e integração com PostgreSQL real;
- [x] imagens Docker de API e worker;
- [x] validação AMD64 e ARM64;
- [x] Docker Compose de produção;
- [x] modos `tunnel` e `public`;
- [x] Caddy, HTTPS e redes privadas;
- [x] backup, restauração e rollback;
- [x] smoke descartável de primeiro deploy e atualização;
- [x] runbook da Oracle Cloud;
- [x] validação pós-merge no commit exato do `main`.
- [x] funil de CRM, oportunidades e histórico comercial;
- [x] tarefas, notas, tags e follow-ups;
- [x] contratos, templates versionados e regras seguras de campanhas;
- [x] persistência transacional de campanhas, outbox, opt-out e dead letters;
- [x] API de gestão, aprovação, preview e campanha exclusivamente simulada;
- [x] gate determinístico de prontidão do piloto com relatório por SHA.

### Ainda não implementado

- [ ] confirmação externa de ausência de site;
- [ ] enriquecimento de telefone, WhatsApp, e-mail e redes sociais;
- [ ] envio por e-mail;
- [ ] envio por WhatsApp oficial;
- [ ] propostas comerciais e PDF;
- [ ] dashboard de conversão;
- [ ] automações completas no n8n;
- [ ] validação operacional em VPS Oracle real.

## Arquitetura

- `apps/api`: API REST Fastify; valida entradas, pagina leads, exporta CSV e enfileira operações.
- `apps/worker`: consome jobs, consulta fontes externas, normaliza, pontua e persiste dados.
- `packages/database`: schema Drizzle, repositórios, deduplicação, migrations e fila transacional.
- `packages/overpass-client`: categorias, consultas seguras, timeout e retry.
- `packages/lead-scoring`: regras puras de pontuação.
- `packages/shared`: contratos, enums e schemas Zod.
- `database/migrations`: SQL versionado e idempotente.
- `n8n/workflows`: automações opcionais.
- `deploy`: Caddyfiles e overrides de produção.
- `scripts`: setup, deploy, backup, restauração e smoke.

## Ambiente oficial — Oracle Cloud VPS

Todas as decisões devem considerar:

- Ubuntu Server 22.04 ou 24.04;
- compatibilidade AMD64 e ARM64;
- Docker Engine e Docker Compose;
- Caddy como única entrada pública em 80/443;
- PostgreSQL, API, worker e n8n em redes privadas;
- API somente em loopback no modo tunnel;
- segredos fora do Git em `.env` com permissão `600`;
- limites de CPU, memória, disco, logs e concorrência;
- filas persistentes e operações idempotentes;
- backup local e cópia externa criptografada;
- restart policies, healthchecks e recuperação;
- nenhuma dependência de navegador aberto;
- e-mail e WhatsApp por APIs oficiais e headless.

Runbook: [`docs/ORACLE_DEPLOY.md`](docs/ORACLE_DEPLOY.md).

## Plano de execução por partes

Cada fase deve usar branch própria, pull request, gates obrigatórios e evidências. Uma fase só é concluída após integração e atualização deste documento.

| Fase | Tarefa | Estado |
|---|---|---|
| Base técnica e Oracle | [#5 — homologar a stack em VPS Oracle real](../../issues/5) | CI concluída; VPS pendente |
| Qualificação | [#6 — contatos, evidências e bloqueio de outreach](../../issues/6) | concluída no PR #14 |
| CRM | [#7 — funil, tarefas e histórico](../../issues/7) | concluída no PR #15; G6 PASS |
| Campanhas | [#8 — e-mail e WhatsApp idempotentes](../../issues/8) | domínio, persistência e API simulada concluídos; worker #19 ativo |
| Piloto interno | [#33 — captação e oferta manual](../../issues/33) | pronto para operação manual; gate automático concluído no PR #38 |
| Propostas | [#9 — propostas de landing pages e sites](../../issues/9) | bloqueada por #7 |
| Dashboard | [#10 — métricas e operação](../../issues/10) | depende das fases anteriores |
| n8n | [#11 — automações recuperáveis](../../issues/11) | depende das APIs anteriores |

Roadmap principal: [#4 — evoluir o Lead Finder para CRM multicanal](../../issues/4).

### Fase 0 — Base técnica e deploy

**Estado:** concluída em CI; pendente de validação em VPS real.

- [x] API, worker, PostgreSQL e migrations;
- [x] Compose local e produção;
- [x] tunnel, Caddy, HTTPS e n8n opcional;
- [x] backup, restauração e rollback;
- [x] CI, integração, smoke e multiarch;
- [ ] primeiro deploy real na Oracle;
- [ ] reinício e persistência;
- [ ] backup e restauração reais;
- [ ] atualização e rollback reais;
- [ ] medição de CPU, memória, disco e logs.

### Fase 1 — Qualificação e enriquecimento

**Estado:** concluída no PR #14, commit `d95e860104ab9a88e3801f9ba340543d00c7c9c8`.

- [x] estados `PENDENTE`, `VALIDANDO`, `SITE_ENCONTRADO`, `SEM_SITE_CONFIRMADO`, `INCONCLUSIVO` e `DESCARTADO`;
- [x] evidências e fontes de validação;
- [x] contatos com tipo, valor, origem, confiança e verificação;
- [x] normalização de telefone, e-mail, nome empresarial e endereço;
- [x] indicação conservadora de telefone potencialmente habilitado para WhatsApp;
- [x] deduplicação por identificador da origem, telefone e nome combinado com endereço;
- [x] bloqueio reutilizável de outreach para não confirmados, bloqueados, descartados ou sem contato validado;
- [x] auditoria de alterações.

**Conclusão:** nenhuma campanha consegue selecionar lead não validado.

### Fase 2 — CRM e funil comercial

**Estado:** concluída no PR #15; G6 validado no commit `236e939722ac5d95e022742d7ee58998fb1f6cc2`.

- [x] etapas `NOVO`, `EM_VALIDACAO`, `QUALIFICADO`, `CONTATO_PENDENTE`, `CONTATADO`, `RESPONDEU`, `REUNIAO`, `PROPOSTA`, `GANHO`, `PERDIDO` e `NAO_CONTATAR`;
- [x] regras de transição;
- [x] notas, tags, prioridade e responsável;
- [x] tarefas e próxima ação;
- [x] histórico imutável;
- [x] prevenção de ações concorrentes.

**Conclusão:** transições inválidas são rejeitadas e todas as mudanças ficam auditáveis.

### Fase 3 — Campanhas e mensagens

**Estado:** domínio, persistência e API de simulação concluídos (#16–#18); worker seguro pendente em #19.

- [x] templates versionados de e-mail e WhatsApp;
- [x] variáveis seguras;
- [x] aprovação humana do primeiro contato;
- [ ] limites globais e janelas de envio;
- [x] idempotência;
- [x] estados persistidos de destinatário, tentativa, evento, outbox e dead letter;
- [x] pausa, retomada e cancelamento na gestão;
- [ ] observação imediata de pausa, cancelamento, resposta e opt-out pelo worker;
- [ ] retry limitado e recuperação auditável de dead-letter no worker;
- [ ] integração de e-mail configurável;
- [ ] WhatsApp por integração oficial.

**Conclusão:** retries e reinícios não produzem mensagens duplicadas.

### Fase 4 — Propostas comerciais

- [ ] catálogo de landing pages e sites;
- [ ] escopo, prazo, preço e validade;
- [ ] proposta vinculada ao lead e oportunidade;
- [ ] PDF e link compartilhável;
- [ ] versionamento e estados comerciais;
- [ ] motivo de perda e valor ganho.

**Conclusão:** oportunidade percorre do lead validado ao fechamento com histórico completo.

### Fase 5 — Dashboard e operação

- [ ] descoberta, validação, descarte e bloqueios;
- [ ] contatos por canal;
- [ ] taxas de resposta, reunião, proposta e fechamento;
- [ ] desempenho por categoria, cidade, origem e campanha;
- [ ] erros, dead letters e mensagens pendentes;
- [ ] follow-ups e leads sem ação;
- [ ] consumo da VPS e saúde dos serviços.

**Conclusão:** métricas são reconciliáveis com eventos e registros do banco.

### Fase 6 — Automação n8n

- [ ] coleta agendada;
- [ ] fila de validação;
- [ ] revisão humana;
- [ ] formação de campanhas;
- [ ] follow-up sem resposta;
- [ ] parada após resposta ou opt-out;
- [ ] alertas;
- [ ] exportação e restauração de workflows.

**Conclusão:** desligar o n8n não corrompe estado nem impede operação manual.

### Fase 7 — Homologação final na Oracle

- [ ] deploy limpo;
- [ ] DNS e TLS, quando aplicável;
- [ ] coleta real controlada;
- [ ] validação e CRM completos;
- [ ] campanha em simulação;
- [ ] envio apenas para contatos próprios de teste;
- [ ] opt-out e bloqueio comprovados;
- [ ] backup, restauração e rollback;
- [ ] reinício e recuperação;
- [ ] relatório final de capacidade.

**Conclusão:** fluxo completo funciona na VPS com evidências reproduzíveis e sem envio indevido.

## Política de execução autônoma

O trabalho poderá avançar automaticamente quando:

- estiver dentro do roadmap aprovado;
- não exigir credenciais novas, pagamento ou acesso humano externo;
- houver testes objetivos;
- a mudança for reversível;
- não houver risco de contato comercial real não autorizado.

Processo padrão:

1. selecionar uma tarefa;
2. criar branch específica;
3. implementar escopo mínimo completo;
4. executar testes;
5. abrir PR com riscos e evidências;
6. corrigir falhas;
7. integrar por squash;
8. verificar o commit exato do `main`;
9. atualizar README e tarefa.

O Codex será solicitado apenas para:

- Docker ou terminal local;
- refatorações amplas em muitos arquivos;
- reprodução no Windows;
- arquivos indisponíveis no GitHub;
- conexão e testes na VPS Oracle real.

## Gates obrigatórios de qualidade

| Gate | Validação | Evidência mínima |
|---|---|---|
| G0 | Escopo e regras de negócio | issue/PR com critérios de aceite |
| G1 | Typecheck, lint e build | run da CI e commit SHA |
| G2 | Testes unitários | quantidade e resultado |
| G3 | Integração PostgreSQL | job e logs |
| G4 | Smoke descartável | primeiro deploy, atualização e rollback |
| G5 | AMD64 e ARM64 | builds e manifests |
| G6 | Pós-merge | status no commit exato do `main` |
| G7 | VPS Oracle real | comandos, logs, ambiente e resultado |
| G8 | Segurança comercial | bloqueios, opt-out e idempotência |

Nenhum gate deve ser ignorado com `continue-on-error` para deixar o pipeline verde.

## Registro e autenticação das evidências

Uma evidência válida deve conter:

- data e hora UTC;
- commit SHA completo;
- branch ou PR;
- ambiente;
- comando, workflow ou cenário;
- run ID, URL ou log;
- resultado `PASS`, `FAIL` ou `BLOCKED`;
- observações e risco residual;
- responsável.

Modelo:

```text
Data UTC:
Commit SHA:
PR/branch:
Ambiente:
Gate:
Comando ou workflow:
Run/log:
Resultado:
Observações:
Responsável:
```

### Evidências consolidadas

| Data UTC | Commit/PR | Ambiente | Gates | Evidência | Resultado |
|---|---|---|---|---|---|
| 2026-07-11 | PR #2 / `a3c9c197...` | GitHub Actions | G1–G5 | CI `29152954163`; smoke `29152954166` | PASS |
| 2026-07-11 | `94c51c4364cd292040ea747d687ba922dab708be` | `main` | base Oracle | squash do PR #2 | PASS |
| 2026-07-11 | PR #3 / `dee9d6d765599255bfaf711de23bbb587785f354` | GitHub Actions | G1–G5 | CI `29154038462`; smoke `29154038485` | PASS |
| 2026-07-11 | `f211d6eb6a9437b51cc14147f11f0d34cb426b6c` | `main` | G6 | `deployment-smoke/post-merge`; run `29155446772` | PASS |
| pendente | commit futuro | VPS Oracle | G7–G8 | homologação operacional | BLOCKED |
| 2026-07-11 | PR #14 / `d95e860104ab9a88e3801f9ba340543d00c7c9c8` | GitHub Actions | G0–G5, G8 | CI `29159498610`; Deployment Smoke `29159498641` | PASS |
| 2026-07-11 | `d95e860104ab9a88e3801f9ba340543d00c7c9c8` | `main` | G6 | `deployment-smoke.yml` não disparou: o merge não alterou paths monitorados | NOT RUN |
| 2026-07-12 | PR #15 / `60ca740a40c036bccaced358ee44edf01bc47f01` | GitHub Actions / PostgreSQL 16 | G0–G5, G8 | CI `29175918041`; Deployment Smoke `29175918046`; integração, imagens e multiarch | PASS |
| 2026-07-12 | `236e939722ac5d95e022742d7ee58998fb1f6cc2` / PR #15 | `main` | G6 | `deployment-smoke/post-merge`; run `29193004346` | PASS |
| 2026-07-13 | `a19f7af8effe198ac28e5f4d96586c32d1be4823` / PR #30 | `main` | G0–G6, G8 | CI, PostgreSQL, multiarch e `deployment-smoke/post-merge` | PASS |
| 2026-07-13 | `bafd0370f9ce463c761596295fe8e5a5f4639087` / PR #37 | `main` | G6 | CI `29263328249`; Check Runs `validate`, `integration` e `multiarch` | PASS |
| 2026-07-13 | `4bae82d1ca301bc6e71870dc71fa7b303a3468b7` / PR #38 | `main` | G1–G6 | CI `29287783121`; smoke `29287783139`; artefato `pilot-readiness-*` | PASS |

A tabela deve ser atualizada sempre que uma fase ou gate mudar de estado.

## Prontidão comercial

O projeto continua sem envio externo. A operação deve usar a [matriz](docs/commercial-readiness-matrix.md), [métricas de qualidade](docs/lead-quality-metrics.md), [métricas do funil](docs/commercial-funnel-metrics.md), [checklists de shadow mode](docs/pilot-shadow-mode-checklist.md) e [piloto manual](docs/pilot-manual-checklist.md), [política de recuperação](docs/lead-recovery-policy.md) e [template de relatório](docs/commercial-readiness-report.template.json). Não há aprovação de piloto nem resultados reais neste material.

## Requisitos locais

- Node.js 22 ou superior;
- npm;
- Docker Engine;
- Docker Compose.

## Configuração local

```bash
cp .env.example .env
```

Defina `POSTGRES_PASSWORD` e ajuste `DATABASE_URL`. Nenhuma credencial real acompanha o repositório.

Variáveis principais: `DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `API_PORT`, `OVERPASS_URL`, `OVERPASS_TIMEOUT_MS`, `OVERPASS_MAX_RETRIES`, `WORKER_POLL_INTERVAL_MS` e `DAILY_LEAD_LIMIT`.

## Execução local

```bash
npm install
docker compose up -d postgres
docker compose run --rm migrate
npm run dev:api
npm run dev:worker
```

Stack completa:

```bash
docker compose up --build
docker compose --profile integration up -d n8n
```

As migrations usam `schema_migrations`; executá-las novamente é seguro.

## API atual

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /leads?page=1&pageSize=20&status=SEM_SITE_CADASTRADO&category=oficinas&city=Campinas&minScore=30`
- `GET /leads/:id`
- `GET /leads/export.csv`
- `GET /leads/:id/qualification`
- `PATCH /leads/:id/qualification`
- `POST /leads/:id/evidence`
- `GET /leads/:id/contacts`
- `PUT /leads/:id/contacts`
- `GET /leads/:id/history`
- `GET /leads/:id/crm`
- `PATCH /leads/:id/crm`
- `PATCH /leads/:id/crm/stage`
- `GET /leads/:id/opportunities`
- `POST /leads/:id/opportunities`
- `PATCH /opportunities/:id`
- `GET /leads/:id/notes`
- `POST /leads/:id/notes`
- `GET /leads/:id/tags`
- `PUT /leads/:id/tags/:tag`
- `DELETE /leads/:id/tags/:tag`
- `GET /leads/:id/tasks`
- `POST /leads/:id/tasks`
- `PATCH /tasks/:id/complete`
- `PATCH /tasks/:id/reschedule`
- `GET /leads/:id/timeline`
- `GET /crm/tasks/overdue`
- `GET /crm/follow-ups/upcoming`
- `POST /campaigns/preview`
- `POST /campaigns`
- `GET /campaigns`
- `GET /campaigns/:id`
- `POST /campaigns/:id/versions`
- `GET /campaigns/:id/versions`
- `GET /campaign-versions/:id/templates`
- `POST /campaign-versions/:id/submit`
- `POST /campaign-versions/:id/approve`
- `POST /campaigns/:id/activate`
- `POST /campaigns/:id/pause`
- `POST /campaigns/:id/resume`
- `POST /campaigns/:id/cancel`
- `GET /campaigns/eligible/leads`
- `POST /campaigns/:id/simulations`
- `GET /campaigns/:id/recipients`
- `GET /recipients/:id/attempts`
- `GET /campaigns/:id/audit`
- `GET /campaigns/failures`
- `POST /collect`

`GET /leads/export.csv` exporta, de forma determinística, no máximo os primeiros 100 registros que correspondem aos filtros. Para conjuntos maiores, use a paginação de `GET /leads`; exportação paginada/completa permanece uma evolução explícita para evitar consumo de memória sem limite.

O núcleo da Fase 1 não envia mensagens. Uma seleção futura para outreach deve obrigatoriamente usar `listOutreachEligibleLeads`: somente leads em `SEM_SITE_CONFIRMADO`, não bloqueados, sem marcação de não contato e com ao menos um contato válido e verificado são retornados.

## Núcleo CRM da Fase 2

A migration idempotente `0003_crm_pipeline.sql` cria oportunidades, notas, tags, tarefas, idempotência e timeline comercial imutável. Estágio, prioridade, responsável, próxima ação e versão otimista permanecem no lead; valores monetários usam `numeric(15,2)` e datas usam `timestamptz` em UTC.

Transições usam uma máquina explícita. Conflitos de versão e idempotência retornam HTTP 409; regras de domínio e transições inválidas retornam 422. A saída de `NAO_CONTATAR` exige ação `REACTIVATE`, motivo, ator e metadados de auditoria. Leads `DESCARTADO`, `isBlocked`, `doNotContact` ou `NAO_CONTATAR` não entram em filas comerciais.

Mutações registram a timeline na mesma transação e usam chave de idempotência com fingerprint do payload. Retry idêntico retorna o recurso anterior sem novo evento; reutilização da chave com payload diferente é conflito. Não existe envio real de e-mail ou WhatsApp nesta fase.

O núcleo de campanhas permanece sem envio externo: preview e simulação produzem snapshots, tentativas e outbox auditáveis, mas não chamam provedores. O próximo passo técnico é o worker seguro da issue #19, com limites distribuídos, retry controlado, dead-letter e observação de bloqueios antes da execução.

A API ainda não possui autenticação/autorização. Os endpoints CRM devem permanecer atrás do perímetro privado até a implementação desses controles.

Exemplo:

```json
{
  "city": "Campinas",
  "state": "SP",
  "country": "Brasil",
  "category": "oficinas",
  "limit": 50
}
```

Categorias atuais: `oficinas`, `autoeletricas`, `saloes-de-beleza`, `barbearias`, `clinicas`, `consultorios`, `restaurantes`, `lanchonetes`, `empresas-de-seguranca` e `prestadores-de-servicos`.

## Comandos de qualidade

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run test:integration
npm run test:pilot
npm run test:pilot:restart
docker compose config
docker build -f apps/api/Dockerfile -t lead-finder-api:test .
docker build -f apps/worker/Dockerfile -t lead-finder-worker:test .
```

A integração usa PostgreSQL real e Overpass mock determinístico. A consulta pública é opcional e nunca substitui o mock como critério da CI.

## Operação

```bash
docker compose ps
docker compose logs --no-color --tail=100 api worker
docker compose stop api worker
docker compose down -v --remove-orphans
```

- `live` com erro indica falha do processo;
- `ready` com HTTP 503 indica indisponibilidade do PostgreSQL;
- o healthcheck do worker confirma o processo principal.

## Backup e restauração

Desenvolvimento:

```bash
docker compose exec -T postgres pg_dump -U leadfinder -d leadfinder -Fc > leadfinder.dump
docker compose exec -T postgres pg_restore -U leadfinder -d leadfinder --clean --if-exists < leadfinder.dump
```

Na Oracle, use os scripts do runbook. Backups não devem permanecer somente no disco da VPS.

## Segurança e conformidade operacional

- nenhuma credencial no Git;
- PostgreSQL sem porta pública;
- API e n8n atrás de Caddy ou tunnel;
- payload, paginação, timeout e retries limitados;
- tratamento de 429, 502 e 504;
- deduplicação concorrente;
- logs sem dados sensíveis;
- opt-out futuro bloqueia todos os canais;
- nenhum envio para lead não validado;
- WhatsApp somente por integração oficial;
- campanhas com pausa imediata e auditoria.

## Limitações atuais

- OSM pode estar incompleto ou desatualizado;
- ausência de site no OSM não confirma ausência real;
- esta versão ainda não envia mensagens;
- não há validação externa de site ou contato;
- não há cota comercial global entre réplicas;
- o deploy foi comprovado em CI, mas ainda não homologado em VPS Oracle real.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada.
