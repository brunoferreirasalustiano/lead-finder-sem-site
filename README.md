# Lead Finder CRM — Prospecção de empresas sem site

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

O sistema deverá executar o seguinte fluxo:

```text
Descoberta -> Normalização -> Deduplicação -> Validação -> Qualificação
-> CRM -> Aprovação -> Campanha -> E-mail/WhatsApp -> Resposta
-> Follow-up -> Proposta -> Ganho/Perdido -> Métricas
```

## Estado atual

### Implementado

- [x] coleta de empresas via OpenStreetMap/Overpass;
- [x] categorias permitidas e consultas protegidas;
- [x] normalização, lead scoring e deduplicação por identificadores OSM;
- [x] PostgreSQL e migrations versionadas;
- [x] fila transacional e worker;
- [x] API REST, paginação, detalhes e exportação CSV;
- [x] testes unitários e integração com PostgreSQL real;
- [x] imagens Docker para API e worker;
- [x] validação AMD64 e ARM64;
- [x] Docker Compose de produção;
- [x] modos `tunnel` e `public`;
- [x] Caddy, HTTPS e redes privadas;
- [x] backup, restauração e rollback de código;
- [x] smoke descartável de primeiro deploy e atualização;
- [x] runbook de implantação na Oracle Cloud;
- [x] validação pós-merge preparada no `main`.

### Ainda não implementado

- [ ] confirmação externa de ausência de site;
- [ ] enriquecimento de telefone, WhatsApp, e-mail e redes sociais;
- [ ] funil de CRM e histórico comercial;
- [ ] tarefas, notas e follow-ups;
- [ ] templates e campanhas;
- [ ] envio por e-mail;
- [ ] envio por WhatsApp oficial;
- [ ] opt-out global e lista de bloqueio;
- [ ] propostas comerciais e PDF;
- [ ] dashboard de conversão;
- [ ] automações completas no n8n;
- [ ] validação operacional em uma VPS Oracle real.

## Arquitetura

- `apps/api`: API REST Fastify; valida entradas, pagina leads, exporta CSV e enfileira operações.
- `apps/worker`: consome jobs, consulta fontes externas, normaliza, pontua e persiste dados.
- `packages/database`: schema Drizzle, repositórios, deduplicação, migrations e fila transacional.
- `packages/overpass-client`: categorias permitidas, construção segura da consulta, timeout e retry.
- `packages/lead-scoring`: regras puras e testáveis de pontuação.
- `packages/shared`: contratos, enums e schemas Zod compartilhados.
- `database/migrations`: SQL versionado e idempotente.
- `n8n/workflows`: automações opcionais, executadas somente quando o profile n8n estiver habilitado.
- `deploy`: Caddyfiles, overrides de tunnel/public e recursos de produção.
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
- reinício automático, healthchecks e recuperação documentada;
- nenhuma dependência de navegador ou sessão gráfica aberta na VPS;
- e-mail e WhatsApp por APIs/provedores oficiais e headless.

Runbook: [`docs/ORACLE_DEPLOY.md`](docs/ORACLE_DEPLOY.md).

## Plano de execução por partes

Cada fase deve ser desenvolvida em branch própria, passar pelos gates de qualidade e ser integrada por pull request. Uma fase só pode ser marcada como concluída quando suas evidências estiverem registradas.

### Fase 0 — Base técnica e deploy

**Estado:** concluída em CI; pendente de validação em VPS real.

Entregáveis:

- [x] API, worker, PostgreSQL e migrations;
- [x] Docker Compose local e produção;
- [x] tunnel, Caddy, HTTPS e n8n opcional;
- [x] backup, restauração e rollback;
- [x] CI, integração, smoke e multiarch;
- [ ] primeiro deploy real na Oracle;
- [ ] reinício da VPS e confirmação de persistência;
- [ ] backup e restauração reais;
- [ ] atualização e rollback reais;
- [ ] medição de CPU, memória, disco e logs.

### Fase 1 — Qualificação e enriquecimento

Entregáveis:

- [ ] estados `PENDENTE`, `VALIDANDO`, `SITE_ENCONTRADO`, `SEM_SITE_CONFIRMADO`, `INCONCLUSIVO` e `DESCARTADO`;
- [ ] evidências e fontes de validação;
- [ ] contatos com tipo, valor, origem, confiança e data de verificação;
- [ ] normalização de telefone e e-mail;
- [ ] detecção de telefone potencialmente habilitado para WhatsApp sem assumir confirmação;
- [ ] deduplicação por telefone, nome normalizado e endereço;
- [ ] bloqueio de outreach para leads não confirmados;
- [ ] auditoria de todas as alterações.

Critério de conclusão: nenhuma campanha consegue selecionar um lead não validado.

### Fase 2 — CRM e funil comercial

Entregáveis:

- [ ] etapas `NOVO`, `EM_VALIDACAO`, `QUALIFICADO`, `CONTATO_PENDENTE`, `CONTATADO`, `RESPONDEU`, `REUNIAO`, `PROPOSTA`, `GANHO`, `PERDIDO` e `NAO_CONTATAR`;
- [ ] regras explícitas de transição;
- [ ] notas, tags, prioridade e responsável;
- [ ] tarefas e próxima ação;
- [ ] histórico imutável de mudanças;
- [ ] prevenção de ações comerciais concorrentes no mesmo lead.

Critério de conclusão: transições inválidas são rejeitadas e todas as alterações ficam auditáveis.

### Fase 3 — Campanhas e mensagens

Entregáveis:

- [ ] templates versionados de e-mail e WhatsApp;
- [ ] variáveis seguras de personalização;
- [ ] aprovação humana do primeiro contato;
- [ ] limites globais por canal e janela de envio;
- [ ] idempotência para impedir duplicidade;
- [ ] estados de tentativa, envio, entrega, erro, resposta e cancelamento;
- [ ] pausa imediata da campanha;
- [ ] retry limitado e dead-letter queue;
- [ ] integração de e-mail configurável;
- [ ] integração oficial de WhatsApp.

Critério de conclusão: retries e reinícios não produzem mensagens duplicadas.

### Fase 4 — Propostas comerciais

Entregáveis:

- [ ] catálogo de landing pages e sites institucionais;
- [ ] escopo, prazo, preço e validade;
- [ ] proposta vinculada ao lead e à oportunidade;
- [ ] geração de PDF e link compartilhável;
- [ ] estados de rascunho, enviada, aceita, recusada e expirada;
- [ ] motivo de perda e valor ganho.

Critério de conclusão: uma oportunidade pode percorrer do lead validado ao fechamento com histórico completo.

### Fase 5 — Dashboard e operação

Entregáveis:

- [ ] leads descobertos, validados, descartados e bloqueados;
- [ ] contatos enviados por canal;
- [ ] taxas de resposta, reunião, proposta e fechamento;
- [ ] desempenho por categoria, cidade, origem e campanha;
- [ ] fila de erros, dead letters e mensagens pendentes;
- [ ] próximos follow-ups e leads sem ação;
- [ ] consumo da VPS e saúde dos serviços.

Critério de conclusão: métricas são reconciliáveis com os eventos e registros do banco.

### Fase 6 — Automação n8n

Entregáveis:

- [ ] coleta agendada;
- [ ] fila de validação;
- [ ] revisão humana de enriquecimento;
- [ ] formação de campanha com leads aprovados;
- [ ] follow-up condicionado à ausência de resposta;
- [ ] parada após resposta ou opt-out;
- [ ] alertas de falha, limite e conversão;
- [ ] exportação e restauração dos workflows.

Critério de conclusão: desligar o n8n não corrompe o estado nem impede operação manual pela API.

### Fase 7 — Homologação na Oracle

Entregáveis:

- [ ] deploy limpo em VPS Oracle;
- [ ] DNS e TLS, quando aplicável;
- [ ] coleta real controlada;
- [ ] validação e CRM completos;
- [ ] campanha em modo de simulação;
- [ ] envio real para contatos próprios de teste;
- [ ] opt-out e bloqueio comprovados;
- [ ] backup, restauração e rollback;
- [ ] teste de reinício e recuperação;
- [ ] relatório final de capacidade.

Critério de conclusão: o fluxo completo funciona na VPS com evidências reproduzíveis e sem envio indevido.

## Política de execução autônoma

O trabalho poderá avançar automaticamente quando:

- a alteração estiver dentro do roadmap aprovado;
- não exigir credenciais novas, pagamento ou acesso humano externo;
- houver testes objetivos para validar o resultado;
- a mudança puder ser revertida por Git, backup ou rollback;
- não houver risco de contato comercial real não autorizado.

O processo padrão será:

1. abrir ou selecionar uma tarefa;
2. criar branch específica;
3. implementar escopo mínimo completo;
4. executar validações relevantes;
5. abrir pull request com riscos e evidências;
6. corrigir falhas até todos os gates obrigatórios passarem;
7. integrar por squash merge;
8. verificar o commit exato do `main`;
9. atualizar este README e a tarefa.

O Codex será solicitado apenas quando houver necessidade de:

- executar ou depurar Docker localmente;
- alterar muitos arquivos com refatoração ampla;
- reproduzir comportamento no Windows;
- operar terminal ou arquivos que não estejam acessíveis pelo GitHub;
- conectar e testar a VPS Oracle real.

## Gates obrigatórios de qualidade

| Gate | Validação | Evidência mínima |
|---|---|---|
| G0 | Escopo e regras de negócio definidos | issue/PR com critérios de aceite |
| G1 | Typecheck, lint e build | run da CI e commit SHA |
| G2 | Testes unitários | quantidade e resultado no run |
| G3 | Integração com PostgreSQL | job e logs de integração |
| G4 | Smoke descartável | run de primeiro deploy, atualização e rollback |
| G5 | AMD64 e ARM64 | builds e manifests validados |
| G6 | Commit pós-merge | status no commit exato do `main` |
| G7 | VPS Oracle real | comandos, logs, data, ambiente e resultado |
| G8 | Segurança comercial | bloqueio de não validados, opt-out e idempotência |

Nenhum gate deve ser ignorado com `continue-on-error` para tornar o pipeline verde.

## Registro e autenticação das evidências

Uma evidência válida deve conter:

- data e hora em UTC;
- commit SHA completo;
- branch ou pull request;
- ambiente: CI, Docker descartável ou VPS Oracle;
- comando, workflow ou cenário executado;
- run ID, URL ou caminho do log;
- resultado: `PASS`, `FAIL` ou `BLOCKED`;
- observações e risco residual;
- responsável pela execução.

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
| 2026-07-11 | PR #2 / `a3c9c197...` | GitHub Actions | G1–G5 | CI `29152954163`; Deployment smoke `29152954166` | PASS |
| 2026-07-11 | `94c51c4364cd292040ea747d687ba922dab708be` | `main` | integração da base Oracle | squash merge do PR #2 | PASS |
| 2026-07-11 | PR #3 / `dee9d6d765599255bfaf711de23bbb587785f354` | GitHub Actions | G1–G5 | CI `29154038462`; Deployment smoke `29154038485` | PASS |
| 2026-07-11 | `f211d6eb6a9437b51cc14147f11f0d34cb426b6c` | `main` | G6 | status `deployment-smoke/post-merge` | PENDING |
| pendente | commit futuro | VPS Oracle | G7–G8 | validação operacional real | BLOCKED |

A tabela deve ser atualizada sempre que uma fase for concluída ou quando um gate relevante mudar de estado.

## Requisitos locais

- Node.js 22 ou superior;
- npm;
- Docker Engine;
- Docker Compose.

## Configuração local

```bash
cp .env.example .env
```

Defina `POSTGRES_PASSWORD` e ajuste `DATABASE_URL`. Os padrões de desenvolvimento usam Campinas/SP/Brasil e limite máximo de 50 leads por coleta. Nenhuma credencial real acompanha o repositório.

Variáveis principais:

- `DATABASE_URL`;
- `POSTGRES_DB`;
- `POSTGRES_USER`;
- `POSTGRES_PASSWORD`;
- `API_PORT`;
- `OVERPASS_URL`;
- `OVERPASS_TIMEOUT_MS`;
- `OVERPASS_MAX_RETRIES`;
- `WORKER_POLL_INTERVAL_MS`;
- `DAILY_LEAD_LIMIT`.

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
- `POST /collect`

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
docker compose config
docker build -f apps/api/Dockerfile -t lead-finder-api:test .
docker build -f apps/worker/Dockerfile -t lead-finder-worker:test .
```

A integração usa PostgreSQL real e um servidor Overpass mock determinístico. A consulta à Overpass pública é opcional e nunca substitui o mock como critério da CI.

## Operação

```bash
docker compose ps
docker compose logs --no-color --tail=100 api worker
docker compose stop api worker
docker compose down -v --remove-orphans
```

Diagnóstico:

- `live` com erro indica falha do processo;
- `ready` com HTTP 503 indica indisponibilidade do PostgreSQL;
- o healthcheck do worker confirma que o processo principal continua ativo.

## Backup e restauração

No desenvolvimento:

```bash
docker compose exec -T postgres pg_dump -U leadfinder -d leadfinder -Fc > leadfinder.dump
docker compose exec -T postgres pg_restore -U leadfinder -d leadfinder --clean --if-exists < leadfinder.dump
```

Na Oracle, use os scripts documentados no runbook. Backups não devem permanecer somente no mesmo disco da VPS.

## Segurança e conformidade operacional

- nenhuma credencial no Git;
- PostgreSQL sem porta pública;
- API e n8n atrás de Caddy ou tunnel;
- payload, paginação, timeout e retries limitados;
- tratamento de 429, 502 e 504;
- deduplicação concorrente;
- logs sem dados sensíveis;
- opt-out futuro deve bloquear todos os canais;
- nenhum envio automático para lead não validado;
- WhatsApp somente por integração oficial;
- campanhas devem ter pausa imediata e trilha de auditoria.

## Limitações atuais

- a fonte OSM pode estar incompleta ou desatualizada;
- ausência de site no OSM não confirma ausência real;
- esta versão ainda não envia mensagens;
- não há validação externa de site ou contato;
- não há cota comercial global entre réplicas;
- o deploy foi comprovado em CI, mas ainda não foi homologado em VPS Oracle real.

Dados do OpenStreetMap estão sujeitos à ODbL e exigem atribuição apropriada em produtos derivados.

## Controle do roadmap

Roadmap principal: [issue #4 — evoluir o Lead Finder para CRM de prospecção multicanal](../../issues/4).

Próxima etapa de implementação: **Fase 1 — Qualificação e enriquecimento**, seguida da base do funil de CRM.
