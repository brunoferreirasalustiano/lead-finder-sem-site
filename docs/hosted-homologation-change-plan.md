# Plano controlado de mudança — homologação hospedada

**Estado:** `PREPARED_NOT_APPROVED`  
**Supabase:** `lead-finder-brasil-homologacao` (`ondvzdvlwntrnieodifi`)  
**Região:** `sa-east-1`  
**Runtime anterior à PR atual:** `946cc79d8b89414a65a621b8e2996adbd8caaab1`  
**Gate operacional:** issue #167  
**Hosted mutations:** `0`  
**Mensagens reais:** `0`

Este plano prepara uma autorização futura. Ele não autoriza deploy, restart, DDL/DML hospedado, roles, credenciais, secrets, providers, egress, dados reais ou envios.

## 1. Evidência consolidada

### Git e qualidade

- PRs #164, #165, #166, #169 e #173 integradas.
- PR #173 tornou atômicos migration + registry e reforçou o replay da role resolvera.
- Na PR atual, CI #705 e Deployment smoke #368 passaram no HEAD `aa80168ab1f8dc111130188212aad8f559ba295e`.
- Typecheck, lint, testes, cobertura, PII, migrations duas vezes, dual registry, PostgreSQL, readiness, restart, restore e multiarch passaram.
- Deep scan dedicado não está exposto; revisão estruturada, CI, testes PostgreSQL, PII e Codex padrão foram usados sem inventar resultado.

### Supabase autenticado, somente leitura

- PostgreSQL `17.6.1.147`.
- `pgcrypto` 1.3 no schema `extensions`.
- `public.schema_migrations`: `0001`–`0018`.
- `supabase_migrations.schema_migrations`: `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl`.
- `0021`–`0026` ausentes dos dois registries.
- Objetos importados de 0019/0020 presentes, com RLS, triggers e ACLs esperados.
- Roles `lead_finder_api_runtime` e `lead_finder_contact_resolver_runtime` ausentes.
- `anon` e `authenticated` sem privilégios efetivos na superfície examinada.
- A tabela de revogações ainda não existe; checagem de tuplas incompatíveis é `NOT_APPLICABLE_TABLE_ABSENT` antes de 0025.

## 2. Invariantes

1. Não reaplicar 0019/0020.
2. Não inserir versões artificialmente no registry local.
3. Migration e registro local pertencem à mesma transação.
4. Aplicar exatamente uma migration por gate hospedado.
5. Não iniciar a próxima antes da pós-validação da anterior.
6. Sanitizações de 0022–0024 só podem ser revertidas pelo backup pré-change comprovadamente restaurável.
7. Criar roles somente após 0026 e pós-validações verdes.
8. API sem `resolve_narrow_contact`; resolvera sem leitura direta de tabelas ou registries.
9. Credenciais de migration, API e resolvera separadas.
10. Credencial resolvera fora do serviço API do Render.
11. Providers, envio, coleta externa e egress desligados.

## 3. Runner hospedado por versão

Cada gate usa:

```bash
MIGRATION_ONLY_VERSION=<EXACT_FILENAME_STEM> npm run db:migrate
```

Regras fail-closed do runner:

- variável ausente: preserva somente o comportamento completo de CI/local;
- variável presente vazia ou só com espaços: `MIGRATION_ONLY_VERSION_BLANK`;
- identificador inexistente: `MIGRATION_ONLY_VERSION_UNKNOWN`;
- predecessor pendente: `MIGRATION_ONLY_PREDECESSOR_PENDING`;
- somente o alvo pode estar pendente na invocação hospedada.

## 4. Gates M21–M26

### M21 — `0021_operator_channel_test`

Dependências: piloto, leads, contatos, reviews, autorizações, opt-outs e `service_role`.

Cria tabelas de preparação/eventos, constraints, índices, append-only, transições e funções SECURITY DEFINER. Habilita RLS e revoga PUBLIC/anon/authenticated.

Antes de M22 validar:

- registry contém 0021 e nenhuma migration posterior;
- tabelas, triggers, funções, RLS e ACLs exatos;
- teste operador ainda desabilitado.

### M22 — `0022_persisted_pii_audit_json`

Cria projeções PII-safe, triggers e backfill de `lead_qualification_history` e `crm_timeline_events`. Remove contato, nomes, notas, descrições, owners e JSON arbitrário.

Antes de M23 validar canários PII ausentes, triggers ativos, função sem EXECUTE público e registry exato.

### M23 — `0023_reference_only_campaign_payloads`

Transforma recipients, attempts, outbox, dead letters e provider events em payloads reference-only, com cinco triggers e backfill.

Antes de M24 validar zero canários PII, cinco triggers ativos, função sem EXECUTE público e registry exato.

### M24 — `0024_crm_idempotency_safe_results`

Cria resultado replay-safe, trigger e backfill de `crm_idempotency_keys`, removendo nomes, contatos, notas, descrições e owners.

Antes de M25 validar replay determinístico, zero canários, trigger e registry exatos.

### M25 — `0025_narrow_contact_resolution`

Cria fingerprint opaco, rotação, revogações append-only, locks, resolver SECURITY DEFINER, fingerprint de mensagem, RLS/revokes/grants e sanitização de snapshots.

Antes de M26 validar exatamente um contato e bloqueios cross-lead, revogado, opt-out, stale e template drift; nenhuma PII persistida; registry exato.

### M26 — `0026_narrow_contact_resolution_hardening`

Normaliza `pgcrypto` para `extensions`, cria unique tuple e FK composta de revogação. Falha fechado diante de revogação histórica incompatível.

Pós-validação final: `pgcrypto` em `extensions`, FK composta presente, readiness exigindo 0026 e registry completo 0021–0026.

## 5. Preflight SQL

Executar com identidade de migration, sem retornar PII:

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

## 6. Backup aceito somente após restore descartável

Antes de qualquer DDL:

1. criar dump privado em formato custom;
2. validar o catálogo;
3. restaurar o mesmo artefato em banco descartável isolado;
4. executar `verify-database-migration`;
5. comparar constraints, índices, triggers, funções, RLS, roles, row counts, hashes e sequences;
6. executar smoke da aplicação;
7. registrar apenas identificador, timestamp e resultado;
8. manter API e worker parados durante restore de prova e janela real.

**Stop pré-DDL:** backup não é aceito sem restore descartável e integridade comprovada.

Como M22–M25 sanitizam dados, rollback dessas migrations é restore integral do backup pré-change; não existe down migration segura para reconstruir conteúdo removido.

## 7. Roles e credenciais

### API runtime

Provar LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, zero memberships/ownership, search path/timeouts, allowlists exatas, sem resolver, sem outbox/dead-letter/lead_contacts, sem registries e sem DDL.

### Resolver runtime

Provar os mesmos atributos restritos, somente USAGE necessário e EXECUTE na assinatura exata do resolver; sem SELECT direto, registries ou DDL; criação duas vezes e rollback duas vezes.

Executar scripts de role por um proprietário único de transação, por exemplo:

```bash
psql --single-transaction --set ON_ERROR_STOP=on
```

Ordem: M21–M26 → pós-validação → roles → testes de privilégio → credenciais separadas → conexões → deploy → pós-deploy.

## 8. Baseline autenticado obrigatório do Render

Confirmar somente leitura:

- workspace e serviço `lead-finder-api-hml`;
- branch e SHA live exatos;
- `autoDeploy=off`;
- health check `/health/ready`;
- identidade PostgreSQL atual;
- health, readiness e logs sanitizados;
- presença sem revelar valores de:
  - `DATABASE_URL`;
  - `API_AUTH_TOKEN`;
  - `API_AUTH_PERMISSIONS`;
  - `INTERNAL_CRON_SECRET`;
  - `CORS_ALLOWED_ORIGINS`;
- valores efetivos:
  - `DEPLOYMENT_PROFILE=supabase-render`;
  - `DRY_RUN=true`;
  - `SHADOW_MODE_ENABLED=true`;
  - `PILOT_KILL_SWITCH_ENABLED=false`;
  - `REAL_SEND_ENABLED=false`;
  - `REAL_PROVIDERS_ENABLED=false`;
  - `REAL_PROVIDER_CONFIGURED=false`;
  - `COLLECTION_EGRESS_ENABLED=false`.

Não exigir variáveis não consumidas pelo runtime/blueprint. Sem evidência autenticada, `RENDER_PREFLIGHT=BLOCKED`.

## 9. Teste sintético do operador

Antes do ensaio autorizado, configurar temporariamente:

- `OPERATOR_TEST_ENABLED=true`;
- `OPERATOR_TEST_KILL_SWITCH_ENABLED=false`;
- `OPERATOR_TEST_WHATSAPP_E164` com valor sintético autorizado;
- `OPERATOR_TEST_FINGERPRINT_KEY`;
- `OPERATOR_TEST_RECIPIENT_BINDING_KEY`;
- `API_AUTH_PERMISSIONS` com:
  - `operator-test:prepare`;
  - `operator-test:open`;
  - `operator-test:confirm`;
  - `operator-test:response`.

O ensaio é provider-free e não usa contato real.

Teardown obrigatório antes de readiness final:

1. remover `OPERATOR_TEST_WHATSAPP_E164`;
2. remover `OPERATOR_TEST_FINGERPRINT_KEY`;
3. remover `OPERATOR_TEST_RECIPIENT_BINDING_KEY`;
4. remover as quatro permissões temporárias de `API_AUTH_PERMISSIONS`, restaurando a allowlist anterior;
5. definir `OPERATOR_TEST_ENABLED=false`;
6. definir `OPERATOR_TEST_KILL_SWITCH_ENABLED=true`;
7. revalidar configuração, readiness, zero provider, zero send e zero egress.

Não desabilitar o teste enquanto qualquer segredo `OPERATOR_TEST_*` permanecer configurado.

## 10. Sequência futura autorizável

1. Revalidar main, CI, smoke, reviews e zero P0/P1.
2. Concluir Render read-only preflight.
3. Provar backup por restore descartável.
4. Congelar writes e parar API/worker conforme runbook.
5. Aplicar M21 com alvo exato; validar Gate M21.
6. Aplicar M22; validar Gate M22.
7. Aplicar M23; validar Gate M23.
8. Aplicar M24; validar Gate M24.
9. Aplicar M25; validar Gate M25.
10. Aplicar M26; validar schema/readiness final.
11. Criar roles transacionalmente e testar privilégios.
12. Criar/rotacionar credenciais separadas sem revelar valores.
13. Atualizar API somente com a credencial da role de API.
14. Manter a credencial resolvera somente no consumidor local.
15. Configurar pré-requisitos sintéticos do operador.
16. Implantar SHA aprovado com auto-deploy desligado.
17. Validar SHA, health, readiness, logs, grants, PII e egress.
18. Executar fluxo sintético provider-free.
19. Executar teardown completo dos secrets/permissões do teste.
20. Revalidar readiness e kill switches.
21. Emitir `HOSTED_HOMOLOGATION_GREEN` ou executar rollback.

## 11. Rollback

- Falha em M21–M26 interrompe a sequência imediatamente.
- Banco: restore integral pré-change comprovado.
- Roles: restaurar conexões anteriores, executar rollback transacional e verificar grants residuais.
- Credenciais: restaurar credencial anterior, provar reconexão e só então revogar a nova; API/resolvera separadamente.
- Aplicação: restaurar SHA live anterior, manter auto-deploy desligado e validar `/health/ready`, identidade PostgreSQL, logs e kill switches.

## 12. Stop conditions

- registry divergente;
- 0019/0020 ausente, duplicada ou sem paridade;
- alvo ausente, vazio, desconhecido ou com predecessor pendente;
- restore descartável falhou;
- pgcrypto não reconciliável;
- revogação histórica incompatível;
- objeto, ACL ou trigger divergente;
- role com membership, ownership, BYPASSRLS, DDL ou grant não allowlisted;
- readiness diferente do schema;
- PII/segredo em resposta, log ou artefato;
- SHA live desconhecido, auto-deploy ativo ou pilot kill switch incompatível;
- configuração do teste operador incompleta;
- teste desabilitado com secrets/permissões temporários ainda presentes;
- provider, envio ou egress inesperado;
- qualquer P0/P1 aberto.

## 13. Gates separados

### Gate A — plano pronto para autorização

`HOSTED_CHANGE_PLAN_APPROVED` exige migrations, roles, Supabase, Render, backup/restore, segurança, rollback e stop conditions comprovados em modo somente leitura. Apenas permite solicitar autorização humana; não permite mutations.

### Gate B — execução autorizada

`HOSTED_EXECUTION_AUTHORIZED=true` exige autorização posterior, específica e inequívoca do proprietário, imediatamente antes das mutations.

### Gate C — execução GO

`EXECUTION_GO=true` exige A+B e revalidação imediata de SHA, CI, registries, Render, backup e zero P0/P1.

## 14. Estado atual

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
