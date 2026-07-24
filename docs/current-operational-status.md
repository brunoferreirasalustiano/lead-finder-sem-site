# Estado operacional consolidado

**Última revisão:** 24 de julho de 2026  
**Baseline funcional aprovada da `main`:** `181d914da253b106ae99d95c5c7792ef87128296`  
**HEAD administrativa atual da `main`:** `c43372fc7fd07a3a2ed1f01ac41f8724614eadd9`  
**Branch HML sincronizada:** `17f12a012dc0e14fa6ce42923ec1d6beb909550f`  
**Render live observado:** `49242ca6c8c0eb5f7792b99ea82f5af7db7d1c76`  
**Gate central:** issue #117  
**Estado:** `REAL_MANUAL_PILOT_BLOCKED`  
**Mensagens:** `NOT_SENT`  
**Contatos enviados:** `0`

Este documento resume o estado verificável do Lead Finder Brasil. O código, as migrations, as evidências de CI e as inspeções autenticadas são a autoridade técnica. Issues e pull requests preservam o histórico detalhado.

A HEAD administrativa atual contém uma criação e remoção imediata de arquivo temporário usado durante a reconciliação documental. A árvore final permaneceu equivalente à baseline funcional aprovada; nenhum código, configuração, banco, secret ou ambiente foi alterado por esses commits administrativos.

## Veredito executivo

A fundação técnica para o piloto manual controlado está implementada e validada, mas nenhum contato real está autorizado.

Comprovado:

- mensageria manual assistida sem provider real;
- autenticação e autorização por ação;
- histórico append-only para autorização, evidência e eventos manuais;
- opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueio administrativo prioritários;
- Data API Supabase em postura deny-all;
- compatibilidade fail-closed dos registros local e Supabase de migrations;
- replay de `0019/0020` bloqueado e testado;
- audit de dependências sem vulnerabilidade alta reportada;
- imagens finais de API e worker sem dependências de desenvolvimento;
- migrations e restore preservados em target operacional separado;
- branch de homologação sincronizada com o hardening atual da `main`;
- paridade de conteúdo entre `main` e HML comprovada após a PR #126;
- API pública live e ready;
- shortlist sanitizada e tracker privado sem PII;
- zero canais `BUSINESS / APPROVED`;
- zero mensagens e contatos enviados.

Ainda bloqueia o piloto:

- `DATABASE_URL` e flags efetivas do Render não comprovados;
- serviço Render executando SHA antigo;
- deploy controlado e gates pós-deploy não executados;
- fichas privadas dos leads prioritários incompletas;
- supressões específicas não consultadas por lead vinculado;
- aprovação individual do operador não emitida.

## Baseline técnica

PRs integradas mais relevantes:

- PR #118 — fundação e governança do gate manual;
- PR #121 — compatibilidade dos registros de migrations;
- PR #122 — correção transitiva de `find-my-way`;
- PR #119 — documentação consolidada do gate #117;
- PR #123 — sincronização inicial da branch HML;
- PR #124 — exclusão de dependências dev das imagens de runtime;
- PR #125 — registro documental do hardening de runtime;
- PR #126 — sincronização do hardening atual na branch HML.

Evidências recentes:

- CI #429 verde para a PR #121;
- CI #438 verde para a PR #122;
- CI #449 verde para a PR #119;
- CI #452 e Deployment smoke #209 verdes para a sincronização HML inicial;
- CI #454 e Deployment smoke #210 verdes para a PR #124;
- CI #457 verde para a atualização documental da PR #125;
- CI #460 e Deployment smoke #212 verdes para a sincronização HML da PR #126;
- CI #461 verde após a integração;
- repetição do multiarch aprovou API, worker e manifests em AMD64/ARM64;
- integração PostgreSQL, restart lógico, persistência e restore-compose aprovados;
- teste de mensageria manual assistida aprovado sem envio externo;
- gate sintético de lote aprovado sem provider, webhook ou egress.

## Registros de migrations

O Supabase de homologação utiliza dois registros legítimos:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: `0019` e `0020`.

A PR #121 implementou:

- leitura dos dois registros;
- reconhecimento por nome lógico;
- classificação `LOCAL`, `SUPABASE`, `BOTH` ou `PENDING`;
- rejeição de nomes ou versões incompatíveis;
- rejeição fail-closed de migration Supabase-only sem validador;
- validação de tabelas, foreign keys, triggers, RLS e ACL;
- segunda execução idempotente;
- zero inserção artificial de `0019/0020` no histórico local;
- ausência de DDL sobre funções e triggers protegidos, comprovada por OID.

Estados:

- `MIGRATION_REGISTRY_SPLIT_VERIFIED`;
- `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_GUARD_PROVED`.

Regras permanentes:

- não reaplicar `0019/0020` manualmente;
- não inserir versões artificialmente no registro local;
- não alterar objetos ou grants fora de migration revisada;
- interromper diante de divergência de histórico ou paridade.

## Segurança de dependências e imagens

### Dependência transitiva

A PR #122 corrigiu `GHSA-c96f-x56v-gq3h` na cadeia:

`@lead-finder/api` → `fastify 5.10.0` → `find-my-way 9.6.0`.

Correção:

- `find-my-way 9.6.0 → 9.7.0`;
- alteração lockfile-only;
- sem `npm audit fix --force`;
- audit final verde nos perfis `oracle-vps` e `supabase-render`.

### Dependências de desenvolvimento no runtime

A inspeção do Render registrou warning de `glob@10.5.0 deprecated` no deploy antigo. A análise da baseline confirmou que `glob`, `tsx` e `typescript` eram dependências de desenvolvimento, mas o `node_modules` completo do estágio de build era copiado para as imagens finais.

A PR #124 implementou:

- target `tools` na imagem da API para migration e restore;
- estágio `production-deps` com `npm prune --omit=dev`;
- API e worker copiando somente dependências de produção;
- build final falhando caso `glob`, `tsx` ou `typescript` estejam no runtime;
- imports e artefatos de produção validados durante o build;
- `migrate` e `restore-suppression` usando explicitamente o target `tools`;
- nenhuma alteração em `render.yaml`, flags, secrets ou banco.

A PR #126 sincronizou esse hardening na branch HML. O warning pode continuar visível no Render enquanto o serviço permanecer no SHA antigo; isso não comprova regressão na imagem nova.

Estados:

- `DEPENDENCY_AUDIT_CLEAN`;
- `RUNTIME_DEV_DEPENDENCIES_EXCLUDED`;
- `OPERATIONAL_TOOLS_TARGET_PRESERVED`;
- `RENDER_HML_RUNTIME_HARDENING_SYNCED`.

## Supabase de homologação

Projeto: `lead-finder-brasil-homologacao`  
Project ref: `ondvzdvlwntrnieodifi`  
Região: `sa-east-1`  
Estado: `ACTIVE_HEALTHY`

Comprovado por inspeção autenticada e somente leitura:

- PostgreSQL ativo;
- registros `0001–0018` e `0019/0020` presentes nos mecanismos correspondentes;
- objetos, constraints, funções, triggers, RLS e ACL esperados presentes;
- RLS habilitada sem policies permissivas;
- zero acesso efetivo para `PUBLIC`, `anon` e `authenticated` nas tabelas manuais;
- `service_role` limitado a `SELECT` e `INSERT` nas tabelas append-only;
- `CREATE` revogado no schema público;
- nenhuma Edge Function ativa para envio;
- zero registros observados nas tabelas operacionais consultadas.

A ausência de registros não substitui a consulta específica de supressões após vincular os IDs privados dos leads.

## Render de homologação

Última inspeção autenticada e somente leitura:

- workspace: `Bruno's workspace`;
- workspace ID: `tea-d72o44oule4c73cut1l0`;
- serviço: `lead-finder-api-hml`;
- service ID: `srv-d9fbpp6rnols73bko9f0`;
- região: Virginia;
- status: live e não suspenso;
- branch efetiva: `hml/render-supabase-plan-b`;
- branch HML atual: `17f12a012dc0e14fa6ce42923ec1d6beb909550f`;
- auto-deploy: desligado;
- health check: `/health/ready`;
- SHA live: `49242ca6c8c0eb5f7792b99ea82f5af7db7d1c76`;
- zero logs recentes de nível `error` na consulta;
- warning de `glob@10.5.0 deprecated` observado no deploy antigo;
- nenhuma ação de deploy, restart, rollback ou alteração de variável executada.

Veredito da inspeção:

`RENDER_HML_RUNTIME_HARDENING_SYNCED_LIVE_OUTDATED`.

O conector disponível não comprovou as variáveis efetivas. Permanecem não verificados:

- correspondência do `DATABASE_URL` com o Supabase inspecionado;
- `DEPLOYMENT_PROFILE=supabase-render`;
- `DRY_RUN=true`;
- `SHADOW_MODE_ENABLED=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`;
- estado efetivo do kill switch.

Configuração declarada no repositório não substitui a comprovação do ambiente efetivo.

Estados:

- `RENDER_READ_ONLY_INSPECTION_COMPLETE`;
- `RENDER_HML_RUNTIME_HARDENING_SYNCED`;
- `RENDER_LIVE_DEPLOYMENT_OUTDATED`;
- `RENDER_EFFECTIVE_FLAGS_NOT_VERIFIED`;
- `RENDER_DATABASE_URL_NOT_VERIFIED`;
- `POST_DEPLOY_GATE_BLOCKED`.

## Mensageria manual assistida

Implementado e aprovado em teste isolado:

- WhatsApp somente com opt-in explícito;
- e-mail somente com evidência `BUSINESS` e decisão humana `APPROVED`;
- templates versionados;
- principal autenticado e permissões por ação;
- idempotência vinculada ao principal;
- replay fail-closed;
- snapshots sem telefone, e-mail ou mensagem integral;
- estados `PREPARED`, `OPENED`, `CONTACT_CONFIRMED` e `RESPONSE_RECORDED`;
- transições protegidas no serviço e PostgreSQL;
- concorrência serializada por lead e preparação;
- zero outbox, attempt e provider event no fluxo manual.

Os testes de mensageria são sintéticos ou de integração local. Não houve envio para WhatsApp, SMTP, OpenAI, webhook ou qualquer lead real.

Abrir um link não confirma envio. `CONTACT_CONFIRMED` depende de confirmação humana explícita.

## Supressões e revogação

Prioridade absoluta:

1. opt-out global;
2. opt-out por canal;
3. `DO_NOT_CONTACT`;
4. `NAO_CONTATAR`;
5. bloqueio administrativo;
6. elegibilidade do contato;
7. autorização do canal.

Autorização posterior não reativa automaticamente um bloqueio. Reativação exige fluxo separado, explícito, auditado e permissionado, fora do piloto atual.

## Primeiro lote manual

Escopo:

- até cinco negócios;
- manutenção e serviços técnicos;
- Campinas/SP e proximidades;
- contato individual e manual;
- WhatsApp somente com opt-in explícito;
- lead frio somente por e-mail empresarial pertinente e aprovado;
- primeiro contato sem link, imagem, PDF, proposta ou preço;
- opt-out imediato;
- nenhum follow-up automático.

Prioridades privadas:

- `LF-TM-01` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-04` — `WEAK_SITE` + `BUSINESS_CANDIDATE`;
- `LF-TM-05` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-09` — `WEAK_SITE` + `BUSINESS_CANDIDATE`.

`BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`. Todos permanecem `NOT_SENT`.

O tracker privado registra identidade, fontes, diagnóstico, canal, supressões, rubrica e aprovação individual sem publicar PII.

## Gates concluídos

- fundação de mensageria manual;
- governança do primeiro contato;
- Data API deny-all;
- compatibilidade e replay guard de migrations;
- audit de dependências;
- exclusão de dependências dev das imagens finais;
- target operacional de migration/restore preservado;
- integração e restart lógico;
- restore-compose;
- imagens AMD64/ARM64 e manifests;
- aviso público de privacidade;
- API pública live e ready;
- endpoint interno protegido;
- categoria e região do primeiro lote;
- shortlist reduzida a quatro prioridades;
- tracker privado preparado;
- branch HML sincronizada com o hardening atual da `main`;
- testes sintéticos e de integração de mensageria aprovados sem envio real.

## Bloqueios restantes

### Ambiente efetivo

- confirmar `DATABASE_URL` sem revelar a connection string;
- confirmar flags efetivas;
- selecionar SHA aprovado;
- realizar deploy controlado somente após autorização específica;
- revisar logs e health checks pós-deploy;
- comprovar restart;
- testar kill switch;
- comprovar ausência observada de egress Meta, SMTP, OpenAI e webhooks;
- comprovar backup/restore aplicável, rollback e smoke test.

### Leads e canais

- recuperar ou reconstruir de forma verificável o mapeamento privado LF-TM;
- concluir até cinco fichas privadas;
- confirmar identidade, atividade, região e diagnóstico;
- classificar canal como `BUSINESS / APPROVED` ou rejeitar;
- obter opt-in válido para WhatsApp;
- consultar opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueios por lead;
- aplicar rubrica mínima `8/10`, sem dimensão em zero;
- obter aprovação individual de Bruno F. Salustiano.

## Próxima sequência operacional

1. integrar esta reconciliação documental após CI verde;
2. manter o Render bloqueado até comprovação das variáveis e do banco efetivos;
3. concluir fichas privadas e supressões dos leads prioritários;
4. preparar checklist de deploy controlado, sem executá-lo;
5. revisar o checklist final da issue #117;
6. emitir `REAL_MANUAL_PILOT_READY` ou manter `REAL_MANUAL_PILOT_BLOCKED`.

Até 28 de julho de 2026 às 14:00, nenhuma tarefa deve depender do Codex. A retomada futura deve apenas selecionar a tarefa técnica de maior valor, com modelo Sol, Terra ou Luna indicado conforme risco e complexidade.

## Integrações fora do piloto

Continuam desligadas:

- WhatsApp Cloud API;
- SMTP ou provider oficial de e-mail;
- OpenAI para rascunhos;
- webhooks assinados;
- follow-ups automáticos;
- n8n para campanhas reais.

WhatsApp Web, Baileys, Evolution API e sessões não oficiais permanecem proibidos.

## Regras de documentação

Não registrar publicamente:

- tokens ou senhas;
- connection strings;
- telefone ou e-mail de lead;
- mensagens integrais;
- payload bruto;
- prints com PII.

Toda alteração de arquitetura, flags, ambiente, segurança, provider, piloto ou estado deve atualizar este documento, o runbook afetado, a issue correspondente e as evidências de CI.
