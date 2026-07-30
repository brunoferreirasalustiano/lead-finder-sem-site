# Plano controlado de mudança — homologação hospedada

**Estado do plano:** `PREPARED_NOT_APPROVED`  
**Projeto Supabase:** `lead-finder-brasil-homologacao` (`ondvzdvlwntrnieodifi`)  
**Região:** `sa-east-1`  
**Runtime de referência:** `946cc79d8b89414a65a621b8e2996adbd8caaab1`  
**Gate operacional:** issue #167  
**Execução hospedada realizada:** `false`  
**Mensagens reais enviadas:** `0`

Este documento prepara uma autorização futura. Ele não autoriza deploy, restart, DDL/DML hospedado, criação de role, rotação de credencial, alteração de segredo, provider, egress, dados reais ou envio.

## 1. Estado comprovado

### Git e qualidade

- PRs #164, #165, #166, #169 e #173 integradas.
- PR #173 tornou atômicos migration + registro e reforçou o replay da role resolvera.
- CI #698 e Deployment smoke #363 passaram no HEAD final da PR #173.
- Migrations duas vezes, dual registry, PostgreSQL, roles, readiness, restart, PII, restore e multiarch passaram.
- O P1 do scanner SQL foi corrigido e resolvido.
- `DEEP_SECURITY_SCAN_AVAILABLE=false`; revisão estruturada, CI, testes PostgreSQL, PII, Codex padrão e inspeção manual foram usados sem inventar resultado de deep scan.

### Supabase autenticado, somente leitura

- PostgreSQL `17.6.1.147`.
- `pgcrypto` 1.3 no schema `extensions`.
- `public.schema_migrations`: `0001` a `0018`.
- `supabase_migrations.schema_migrations`: `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl`.
- `0021`–`0026` ausentes dos dois registries.
- Objetos importados de 0019/0020 presentes, com RLS e triggers esperados.
- Roles `lead_finder_api_runtime` e `lead_finder_contact_resolver_runtime` ausentes.
- `anon` e `authenticated` sem privilégios efetivos na superfície pública examinada.
- A tabela de revogações ainda não existe; a checagem de tuplas incompatíveis é `NOT_APPLICABLE_TABLE_ABSENT` antes de 0025.

## 2. Invariantes

1. Não reaplicar 0019/0020.
2. Não inserir versões artificialmente no registry local.
3. Cada migration e seu registro local pertencem à mesma transação do runner.
4. Aplicar exatamente uma migration por gate hospedado.
5. Não iniciar a próxima migration antes de validar a anterior.
6. Sanitizações históricas de 0022–0024 só podem ser revertidas por restore comprovado do backup pré-change.
7. Criar roles somente após 0026 e todas as pós-validações verdes.
8. API sem `resolve_narrow_contact`; resolvera sem leitura direta de tabelas ou registries.
9. Credenciais de migration, API e resolvera são separadas.
10. A credencial resolvera permanece fora do serviço de API do Render.
11. Providers, envio, coleta externa e egress permanecem desligados.

## 3. Ordem e gates das migrations

A execução hospedada futura deve usar uma invocação por versão:

```bash
MIGRATION_ONLY_VERSION=<EXACT_FILENAME_STEM> npm run db:migrate
```

O runner bloqueia alvo desconhecido e bloqueia quando qualquer predecessor ainda está `PENDING`. Sem `MIGRATION_ONLY_VERSION`, o comportamento completo permanece reservado a CI/local; não é o procedimento hospedado aprovado.

### Gate M21 — `0021_operator_channel_test`

**Dependências:** piloto, leads, contatos, reviews, autorizações, opt-outs e `service_role`.  
**Cria:** tabelas de preparação/eventos, constraints, índices, append-only, transição e funções SECURITY DEFINER.  
**Segurança:** RLS; PUBLIC/anon/authenticated revogados; service_role allowlisted.  
**Histórico:** sem sanitização destrutiva.  
**Pós-validação antes de M22:** registry contém somente 0021 entre as pendentes; tabelas, triggers, funções, RLS e ACLs exatos; teste operador ainda desabilitado.  
**Stop:** qualquer objeto, ACL, trigger ou registry divergente.

### Gate M22 — `0022_persisted_pii_audit_json`

**Dependências:** 0021 validada, `lead_qualification_history`, `crm_timeline_events`.  
**Altera:** projeções PII-safe, triggers e backfill histórico.  
**Impacto:** remove contato, nomes, notas, descrições, owners e JSON arbitrário.  
**Pós-validação antes de M23:** canários PII ausentes, triggers ativos, função sem EXECUTE público, registry exato.  
**Rollback:** restore do backup pré-change; não existe down migration capaz de reconstruir dados removidos.

### Gate M23 — `0023_reference_only_campaign_payloads`

**Dependências:** M22 validada; recipients, attempts, outbox, dead letters e provider events.  
**Altera:** payloads reference-only, cinco triggers e backfill.  
**Impacto:** remove snapshots/payloads livres e preserva apenas IDs/estados allowlisted.  
**Pós-validação antes de M24:** zero canários PII, cinco triggers ativos, função sem EXECUTE público, registry exato.  
**Rollback:** restore do backup pré-change.

### Gate M24 — `0024_crm_idempotency_safe_results`

**Dependências:** M23 validada e `crm_idempotency_keys`.  
**Altera:** função replay-safe, trigger e backfill de `result`.  
**Impacto:** remove nomes, contatos, notas, descrições e owners.  
**Pós-validação antes de M25:** replay determinístico, zero canários PII, trigger e registry exatos.  
**Rollback:** restore do backup pré-change.

### Gate M25 — `0025_narrow_contact_resolution`

**Dependências:** M24 validada, pgcrypto, 0019/0020, piloto, contatos, reviews, autorizações, evidência de e-mail, opt-outs e bloqueios.  
**Cria/altera:** fingerprint opaco, rotação, revogações append-only, locks, resolver SECURITY DEFINER, fingerprint de mensagem, RLS/revokes/grants e sanitização de snapshots.  
**Pós-validação antes de M26:** resolução de exatamente um contato; cross-lead, revogado, opt-out, stale e template drift bloqueados; nenhuma PII persistida; registry exato.  
**Rollback:** restore integral pré-change.

### Gate M26 — `0026_narrow_contact_resolution_hardening`

**Dependências:** M25 validada.  
**Altera:** normaliza pgcrypto para `extensions`; unique tuple; preflight agregado e FK composta de revogação.  
**Stop:** qualquer revogação histórica cuja tupla não corresponda à autorização.  
**Pós-validação final de schema:** pgcrypto em `extensions`, FK composta, readiness exigindo 0026, registry completo 0021–0026.  
**Rollback:** restore integral pré-change.

## 4. Preflight SQL obrigatório

Executar com identidade de migration e sem retornar PII:

```sql
SELECT current_database(), current_setting('server_version');

SELECT n.nspname AS pgcrypto_schema
FROM pg_catalog.pg_extension e
JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
WHERE e.extname='pgcrypto';

SELECT version FROM public.schema_migrations ORDER BY version;
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

SELECT rolname
FROM pg_catalog.pg_roles
WHERE rolname IN ('lead_finder_api_runtime','lead_finder_contact_resolver_runtime');
```

Se a tabela de revogações existir:

```sql
SELECT count(*)::int AS incompatible_revocations
FROM public.contact_channel_authorization_revocations r
LEFT JOIN public.contact_channel_authorizations a
  ON a.id=r.authorization_id
 AND a.contact_id=r.contact_id
 AND a.lead_id=r.lead_id
 AND a.purpose=r.purpose
WHERE a.id IS NULL;
```

## 5. Backup aceito somente após restore descartável

Antes de qualquer DDL:

1. criar dump privado em formato custom;
2. validar o catálogo do dump;
3. restaurar esse mesmo artefato em banco descartável isolado;
4. executar `verify-database-migration`, inventário de constraints/índices/triggers/funções/RLS/roles, row-count/hash comparisons, `setval` e smoke da aplicação;
5. registrar apenas identificador, timestamp e resultado, nunca URL ou segredo;
6. provar que o banco fonte permanece intacto e pode voltar a receber clientes;
7. manter API e worker parados durante o restore de prova e a janela real.

**Stop pré-DDL:** backup não é aceito sem restore descartável e verificação de integridade concluídos com sucesso.

## 6. Roles e credenciais

### API runtime

Provar LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, zero memberships/ownership, search path/timeouts, tabelas/funções allowlisted, sem resolver, sem outbox/dead-letter/lead_contacts, sem DML amplo, registries ou DDL.

### Resolver runtime

Provar os mesmos atributos restritos, somente USAGE necessário e EXECUTE na assinatura exata do resolver; sem SELECT direto, registries ou DDL; criação duas vezes e rollback duas vezes.

Scripts de role devem ser executados por um único proprietário de transação, por exemplo:

```bash
psql --single-transaction --set ON_ERROR_STOP=on
```

Ordem: schema M21–M26 → pós-validação → roles → testes positivos/negativos → criação/rotação de credenciais → troca controlada das conexões → deploy → pós-deploy.

## 7. Baseline autenticado obrigatório do Render

Confirmar em modo somente leitura:

- workspace e serviço `lead-finder-api-hml`;
- branch e SHA live exatos;
- `autoDeploy=off`;
- health check `/health/ready`;
- identidade PostgreSQL atual;
- health, readiness e logs sanitizados;
- presença, sem revelar valores, de:
  - `DATABASE_URL`;
  - `API_AUTH_TOKEN`;
  - `API_AUTH_PERMISSIONS`;
  - `INTERNAL_CRON_SECRET`;
  - `CORS_ALLOWED_ORIGINS`;
- valores efetivos esperados:
  - `DEPLOYMENT_PROFILE=supabase-render`;
  - `DRY_RUN=true`;
  - `SHADOW_MODE_ENABLED=true`;
  - `REAL_SEND_ENABLED=false`;
  - `REAL_PROVIDERS_ENABLED=false`;
  - `REAL_PROVIDER_CONFIGURED=false`;
  - `COLLECTION_EGRESS_ENABLED=false`.

Não exigir variáveis que o runtime/blueprint não consome. Sem esta evidência autenticada, `RENDER_PREFLIGHT=BLOCKED`.

## 8. Teste sintético do operador

Não executar o fluxo após as mutations sem prepará-lo antes. Na fase de configuração autorizada, confirmar temporariamente:

- `OPERATOR_TEST_ENABLED=true`;
- `OPERATOR_TEST_KILL_SWITCH_ENABLED=false` somente durante o ensaio;
- `OPERATOR_TEST_WHATSAPP_E164` contém valor sintético autorizado;
- `OPERATOR_TEST_FINGERPRINT_KEY` presente;
- `OPERATOR_TEST_RECIPIENT_BINDING_KEY` presente;
- `API_AUTH_PERMISSIONS` inclui:
  - `operator-test:prepare`;
  - `operator-test:open`;
  - `operator-test:confirm`;
  - `operator-test:response`.

O teste permanece provider-free e não usa contato real. Após a evidência, restaurar `OPERATOR_TEST_ENABLED=false` e `OPERATOR_TEST_KILL_SWITCH_ENABLED=true`, revalidando readiness e ausência de envio/egress.

## 9. Sequência futura autorizável

1. Revalidar main, CI, smoke, reviews e zero P0/P1.
2. Concluir Render read-only preflight.
3. Provar backup por restore descartável.
4. Congelar writes e manter API/worker parados conforme runbook.
5. Aplicar M21 com `MIGRATION_ONLY_VERSION`; validar Gate M21.
6. Aplicar M22; validar Gate M22.
7. Aplicar M23; validar Gate M23.
8. Aplicar M24; validar Gate M24.
9. Aplicar M25; validar Gate M25.
10. Aplicar M26; validar schema/readiness final.
11. Criar roles com cliente transacional; executar testes de privilégios.
12. Criar/rotacionar credenciais separadas sem revelar valores.
13. Atualizar a API somente com a credencial da role de API.
14. Manter a credencial resolvera somente no consumidor local restrito.
15. Configurar pré-requisitos sintéticos do operador.
16. Implantar SHA aprovado com auto-deploy desligado.
17. Validar SHA live, health, readiness, logs, grants, PII e egress.
18. Executar fluxo sintético provider-free.
19. Desabilitar novamente o teste operador e validar os kill switches.
20. Emitir `HOSTED_HOMOLOGATION_GREEN` ou executar rollback.

## 10. Rollback

### Banco

Falha em qualquer gate M21–M26 interrompe a sequência. Como M22–M25 sanitizam dados, o rollback da unidade é restore do backup pré-change comprovado. Nunca apagar histórico nem remover constraints para prosseguir.

### Roles

Restaurar primeiro as conexões anteriores; depois executar rollback transacional das roles e confirmar ausência de grants residuais.

### Credenciais

Preservar referência segura à credencial anterior, restaurar conexão anterior, provar reconexão e só então revogar a nova. API e resolvera são revertidas separadamente.

### Aplicação

Restaurar SHA live anterior conhecido, manter auto-deploy desligado, validar `/health/ready`, identidade PostgreSQL, logs e kill switches.

## 11. Stop conditions

- registry divergente;
- 0019/0020 ausente, duplicada ou sem paridade;
- predecessor pendente para `MIGRATION_ONLY_VERSION`;
- restore descartável do backup falhou;
- pgcrypto não reconciliável;
- revogação histórica incompatível;
- objeto/ACL/trigger pós-migration divergente;
- role com membership, ownership, BYPASSRLS, DDL ou grant não allowlisted;
- readiness diferente do schema;
- PII/segredo em resposta, log ou artefato;
- SHA live desconhecido ou auto-deploy ativo;
- configuração do teste operador incompleta;
- provider, envio ou egress inesperado;
- qualquer P0/P1 aberto.

## 12. Gates separados

### Gate A — plano pronto para autorização

Declarar `HOSTED_CHANGE_PLAN_APPROVED` somente quando migrations, roles, Supabase, Render, backup/restore, segurança, rollback e stop conditions estiverem comprovados em modo somente leitura. Este status apenas permite solicitar a autorização humana específica; não permite mutations.

### Gate B — execução autorizada

Declarar `HOSTED_EXECUTION_AUTHORIZED=true` somente após autorização posterior, específica e inequívoca do proprietário, imediatamente antes das mutations hospedadas.

### Gate C — execução GO

`EXECUTION_GO=true` exige Gate A + Gate B + revalidação imediata de SHA, CI, registries, Render, backup e zero P0/P1.

## 13. Estado atual

- `MIGRATIONS_PREFLIGHT=PASS_AFTER_CURRENT_PR_MERGE`;
- `ROLES_PREFLIGHT=PASS`;
- `SUPABASE_PREFLIGHT=PASS`;
- `RENDER_PREFLIGHT=BLOCKED_AUTHENTICATED_EVIDENCE_MISSING`;
- `ROLLBACK_PLAN=PASS`;
- `HOSTED_CHANGE_PLAN_APPROVED=false`;
- `HOSTED_EXECUTION_AUTHORIZED=false`;
- `EXECUTION_GO=false`;
- `HOSTED_MUTATIONS=0`;
- `HOSTED_HOMOLOGATION_EXECUTED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`;
- `MESSAGES_SENT=0`;
- `REAL_LEADS_CONTACTED=0`.
