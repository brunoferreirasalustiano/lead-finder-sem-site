# Estado operacional consolidado

**Última revisão:** 23 de julho de 2026  
**Baseline integrada da `main`:** `d45c2b47cbd7e1787623fa992d9d3b727daea964`  
**Gate central:** issue #117  
**Estado:** `REAL_MANUAL_PILOT_BLOCKED`  
**Mensagens:** `NOT_SENT`  
**Contatos enviados:** `0`

Este documento é a fonte resumida do estado operacional atual do Lead Finder Brasil. O código, as migrations, as evidências de CI e as inspeções autenticadas são a autoridade técnica. Issues e pull requests preservam o histórico detalhado.

## Veredito executivo

A fundação técnica para um piloto manual controlado está implementada e extensivamente validada, mas o envio real ainda não está autorizado.

Comprovado:

- mensageria manual assistida sem provider real;
- shadow mode e defaults fail-closed;
- autenticação e autorização por ação;
- opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueio administrativo prioritários;
- histórico append-only para autorização, evidência e eventos manuais;
- Data API Supabase em postura deny-all;
- compatibilidade fail-closed dos dois registros de migrations;
- replay de migrations `0019/0020` bloqueado e testado;
- audit de dependências sem vulnerabilidade alta conhecida;
- API pública de homologação viva e pronta pelos health checks;
- shortlist sanitizada e tracker privado sem PII;
- nenhum lead aprovado para contato;
- nenhum envio, provider, webhook ou egress de campanha habilitado.

Ainda bloqueia o piloto:

- variáveis efetivas e `DATABASE_URL` do Render não comprovados;
- Render executa um SHA antigo;
- deploy controlado e gates pós-deploy não executados;
- fichas privadas dos leads prioritários incompletas;
- zero canais `BUSINESS / APPROVED` e zero opt-ins válidos;
- supressões específicas ainda não consultadas por lead vinculado;
- aprovação individual do operador ainda não emitida.

## Baseline técnica

PRs integradas mais relevantes:

- PR #118 — fundação e governança do gate manual;
- PR #121 — compatibilidade dos registros de migrations;
- PR #122 — atualização transitiva de segurança de `find-my-way`.

Evidências:

- CI #429 integralmente verde para a PR #121;
- Deployment smoke #207 verde;
- CI #438 integralmente verde para a PR #122;
- `npm audit --audit-level=high` verde nos perfis `oracle-vps` e `supabase-render`;
- integração PostgreSQL, restart lógico, persistência, restore-compose e multiarch aprovados.

## Registros de migrations

O banco de homologação utiliza dois registros legítimos:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: `0019` e `0020`.

A PR #121 implementou:

- leitura dos dois registros;
- reconhecimento por nome lógico;
- classificação `LOCAL`, `SUPABASE`, `BOTH` ou `PENDING`;
- rejeição de nomes ou versões incompatíveis;
- rejeição fail-closed de migration Supabase-only sem validador explícito;
- validação de tabelas, foreign keys, triggers, RLS e ACL de `0019/0020`;
- execução idempotente em PostgreSQL descartável;
- zero inserção artificial de `0019/0020` em `public.schema_migrations`;
- ausência de DDL sobre funções e triggers protegidos, comprovada por OID.

Estados:

- `MIGRATION_REGISTRY_SPLIT_VERIFIED`;
- `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_GUARD_PROVED`.

Regras permanentes:

- não reaplicar `0019/0020` manualmente;
- não inserir versões artificialmente no registro local;
- não alterar objetos ou grants fora de migration revisada;
- interromper a operação diante de divergência de histórico ou paridade.

## Segurança de dependências

A PR #122 corrigiu o advisory alto `GHSA-c96f-x56v-gq3h` na cadeia:

`@lead-finder/api` → `fastify 5.10.0` → `find-my-way 9.6.0`.

Correção:

- `find-my-way 9.6.0 → 9.7.0`;
- alteração final somente em `package-lock.json`;
- atualização lockfile-only;
- sem `npm audit fix --force`;
- audit final com zero vulnerabilidades reportadas.

Estado: `DEPENDENCY_AUDIT_CLEAN`.

## Supabase de homologação

Projeto: `lead-finder-brasil-homologacao`  
Project ref: `ondvzdvlwntrnieodifi`  
Região: `sa-east-1`  
Estado: `ACTIVE_HEALTHY`

Comprovado por inspeção autenticada e somente leitura:

- PostgreSQL ativo;
- `0001–0018` no registro local;
- `0019/0020` no registro Supabase;
- objetos, constraints, funções, triggers, RLS e ACL esperados presentes;
- RLS habilitada sem policies permissivas;
- zero acesso efetivo para `PUBLIC`, `anon` e `authenticated` nas tabelas manuais;
- `service_role` limitado a `SELECT` e `INSERT` nas tabelas append-only;
- `CREATE` revogado no schema público;
- nenhuma Edge Function ativa para envio;
- zero registros observados nas tabelas operacionais consultadas.

Tabelas verificadas sem atividade operacional:

- `campaign_opt_outs`;
- `contact_channel_authorizations`;
- `contact_email_business_evidence`;
- `pilot_manual_contacts`;
- `pilot_manual_message_preparations`;
- `pilot_manual_message_events`.

A ausência de registros não substitui a consulta específica de supressões após vincular os IDs privados dos leads.

## Render de homologação

Inspeção autenticada e somente leitura:

- workspace: `Bruno's workspace`;
- serviço: `lead-finder-api-hml`;
- service ID: `srv-d9fbpp6rnols73bko9f0`;
- região: Virginia;
- status: `live`, não suspenso;
- branch: `hml/render-supabase-plan-b`;
- auto-deploy: desligado;
- health check: `/health/ready`;
- deploy live: `dep-d9fouq3bc2fs73bl3r40`;
- SHA implantado: `49242ca6c8c0eb5f7792b99ea82f5af7db7d1c76`;
- logs consultados: zero erros e dois warnings de dependência obsoleta;
- nenhuma ação de deploy, restart, rollback ou alteração de variável executada.

O SHA live é anterior à baseline atual da `main`. Portanto, o ambiente efetivo não comprova a versão atual.

O Render MCP não disponibilizou leitura das variáveis de ambiente. Permanecem não comprovados:

- correspondência do `DATABASE_URL` com o Supabase inspecionado;
- `DEPLOYMENT_PROFILE=supabase-render`;
- `DRY_RUN=true`;
- `SHADOW_MODE_ENABLED=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`;
- estado efetivo do kill switch.

Configuração declarada em `render.yaml` é fail-closed, mas não substitui a comprovação do ambiente efetivo.

Estado:

- `RENDER_READ_ONLY_INSPECTION_COMPLETE`;
- `RENDER_DEPLOYMENT_OUTDATED`;
- `RENDER_EFFECTIVE_FLAGS_NOT_VERIFIED`;
- `RENDER_DATABASE_URL_NOT_VERIFIED`;
- `POST_DEPLOY_GATE_BLOCKED`.

## Evidência pública reproduzível

### GitHub Pages

Comprovado:

- home HTTP 200;
- `/privacidade/` HTTP 200;
- demonstração HTTP 200;
- aviso de privacidade servido;
- canonical e navegação interna válidos;
- indexação habilitada;
- nenhum formulário próprio;
- nenhum Google Analytics, Tag Manager, Meta Pixel, Hotjar ou Clarity;
- nenhum dado ou mensagem enviado pelo probe.

### API Render

Comprovado por probe público somente leitura:

- `/health/live`: HTTP 200, `status=ok`;
- `/health/ready`: HTTP 200, `status=ready`;
- `/internal/operational-snapshot` sem token: HTTP 401;
- nenhuma rota de escrita chamada;
- nenhum provider, webhook ou envio acionado.

## Mensageria manual assistida

Implementado:

- contratos discriminados por canal;
- WhatsApp somente com opt-in explícito;
- e-mail somente com evidência `BUSINESS` e decisão humana `APPROVED`;
- templates versionados;
- principal autenticado e permissões por ação;
- idempotência vinculada ao principal;
- replay fail-closed;
- snapshots minimizados sem telefone, e-mail ou mensagem integral;
- estados `PREPARED`, `OPENED`, `CONTACT_CONFIRMED` e `RESPONSE_RECORDED`;
- transições protegidas no serviço e PostgreSQL;
- concorrência serializada por lead e preparação;
- zero outbox, attempt e provider event no fluxo manual.

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

Uma autorização posterior não reativa automaticamente um bloqueio. Reativação exige fluxo separado, explícito, auditado e permissionado, fora do piloto atual.

## Primeiro lote manual

Escopo:

- até cinco negócios;
- manutenção e serviços técnicos;
- Campinas/SP e proximidades;
- contato individual e manual;
- revisão humana por lead;
- WhatsApp somente com opt-in explícito;
- lead frio somente por e-mail empresarial pertinente e aprovado;
- primeiro contato sem link, imagem, PDF, proposta ou preço;
- opt-out imediato;
- nenhum follow-up automático.

### Shortlist privada

Dez códigos sanitizados foram reduzidos para quatro prioridades:

- `LF-TM-01` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-04` — `WEAK_SITE` + `BUSINESS_CANDIDATE`;
- `LF-TM-05` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-09` — `WEAK_SITE` + `BUSINESS_CANDIDATE`.

Pendentes por canal `UNKNOWN`:

- `LF-TM-02`;
- `LF-TM-06`;
- `LF-TM-08`.

Inelegíveis com a evidência atual:

- `LF-TM-03`;
- `LF-TM-07`;
- `LF-TM-10`.

`BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`. Todos permanecem `NOT_SENT`.

Um tracker sem PII foi armazenado em área privada para registrar:

- identidade e atividade;
- região;
- fontes mínimas;
- diagnóstico digital;
- classificação e decisão humana do canal;
- opt-out por canal e global;
- `DO_NOT_CONTACT`;
- `NAO_CONTATAR`;
- bloqueio administrativo;
- versão e rubrica da mensagem;
- aprovação individual.

## Gates concluídos

- fundação de mensageria manual integrada;
- governança do primeiro contato integrada;
- Data API deny-all comprovada;
- migrations `0019/0020` localizadas e validadas;
- runner compatível com os dois registros;
- replay guard comprovado;
- audit de dependências limpo;
- testes de integração e restart lógico aprovados;
- restore-compose aprovado;
- multiarch aprovado;
- aviso público de privacidade servido;
- API pública live e ready;
- endpoint interno protegido;
- pivot de barbearias concluído;
- manutenção e serviços técnicos selecionados;
- shortlist reduzida a quatro prioridades;
- tracker privado preparado.

## Bloqueios restantes

### Ambiente efetivo

- confirmar `DATABASE_URL` sem revelar a connection string;
- confirmar as flags efetivas;
- escolher SHA aprovado e com CI verde;
- realizar deploy controlado;
- revisar logs e health checks pós-deploy;
- comprovar restart;
- testar kill switch;
- comprovar ausência observada de egress Meta, SMTP, OpenAI e webhooks;
- comprovar backup/restore aplicável, rollback e smoke test.

### Leads e canais

- concluir até cinco fichas privadas;
- eliminar duplicidades e homônimos;
- confirmar identidade, atividade, cidade e diagnóstico;
- registrar fontes mínimas;
- classificar e-mail como `BUSINESS / APPROVED` ou rejeitar;
- obter opt-in válido para qualquer uso de WhatsApp;
- consultar todas as supressões por lead vinculado;
- aplicar a decisão mais restritiva;
- obter aprovação individual de Bruno F. Salustiano.

### Mensagens

- personalizar sem alegações enganosas;
- aplicar rubrica mínima `8/10`, sem dimensão em zero;
- manter `NOT_SENT` até o veredito final;
- registrar envio apenas após confirmação humana;
- registrar resposta e opt-out sem copiar conteúdo sensível.

## Próxima sequência operacional

1. concluir e integrar a documentação da PR #119;
2. confirmar banco e flags efetivas do Render sem expor secrets;
3. executar deploy controlado e gates pós-deploy;
4. concluir as fichas privadas dos quatro códigos prioritários;
5. qualificar canais e consultar supressões;
6. montar até cinco pacotes para aprovação individual;
7. revisar o checklist final da issue #117;
8. emitir `REAL_MANUAL_PILOT_READY` ou manter `REAL_MANUAL_PILOT_BLOCKED`.

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

Não registrar em documentação pública:

- tokens ou senhas;
- connection strings;
- telefone ou e-mail de lead;
- mensagens integrais;
- payload bruto;
- prints com PII.

Toda alteração de arquitetura, flags, ambiente, segurança, provider, piloto ou estado deve atualizar este documento, o runbook afetado, a issue correspondente e as evidências de CI.