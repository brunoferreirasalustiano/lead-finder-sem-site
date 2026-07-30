# Plano controlado de mudança — homologação hospedada

**Estado do plano:** `PREPARED_NOT_APPROVED`  
**Projeto Supabase:** `lead-finder-brasil-homologacao` (`ondvzdvlwntrnieodifi`)  
**Região:** `sa-east-1`  
**Runtime aprovado:** `946cc79d8b89414a65a621b8e2996adbd8caaab1`  
**`main` verificada:** `946cc79d8b89414a65a621b8e2996adbd8caaab1`  
**Gate operacional:** issue #167  
**Execução hospedada realizada:** `false`  
**Mensagens reais enviadas:** `0`

Este documento é um plano executável para uma autorização futura. Ele não autoriza nem executa deploy, restart, DDL/DML hospedado, criação de role, troca de credencial, alteração de segredo, provider, egress, uso de dados reais ou envio.

## 1. Evidência somente leitura já comprovada

### Git e qualidade

- PRs #164, #165, #166, #169 e #173 integradas.
- PR #173 corrige atomicidade de migration/registry e reforça replay da role resolvera.
- CI #698, Deployment smoke #363, PII, PostgreSQL, dual registry, readiness, restart e multiarch passaram no HEAD exato da PR #173.
- O único P1 da revisão Sol da PR #173 foi corrigido por scanner SQL de nível superior, comprovado pela CI e resolvido.
- Deep scan dedicado não está exposto; revisão estruturada, CI, testes PostgreSQL, PII, revisão Codex padrão e inspeção manual foram usados sem inventar resultado de deep scan.

### Supabase autenticado

Observado em modo somente leitura:

- PostgreSQL `17.6.1.147`;
- `pgcrypto` `1.3` no schema `extensions`;
- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl`;
- migrations `0021`–`0026` ausentes dos dois registries;
- tabelas importadas de 0019/0020 presentes, com RLS e triggers obrigatórios habilitados;
- roles `lead_finder_api_runtime` e `lead_finder_contact_resolver_runtime` ausentes;
- `anon` e `authenticated` sem privilégios efetivos nas tabelas e funções públicas examinadas;
- nenhuma revogação de autorização existe porque a tabela de revogações ainda será criada pela 0025.

## 2. Regras invariáveis

1. `0019` e `0020` não serão reaplicadas.
2. Nenhuma versão será inserida artificialmente em `public.schema_migrations`.
3. O runner será a única autoridade da transação: cada migration e seu registro local serão confirmados atomicamente.
4. As migrations serão executadas em ordem e como uma única janela controlada.
5. Os dados históricos sanitizados por 0022–0024 não serão reconstruídos por down migration; rollback exige restore do backup pré-change.
6. Roles serão criadas apenas depois de migrations e pós-validações verdes.
7. A role de API não executará `resolve_narrow_contact`.
8. A role resolvera não terá acesso direto a tabelas, registries ou DDL.
9. A credencial resolvera não será configurada no serviço de API do Render; ela pertence ao consumidor local restrito.
10. Providers, envio real, coleta externa e egress permanecerão desligados.

## 3. Matriz das migrations

### `0021_operator_channel_test`

**Dependências:** tabelas de piloto, leads, contatos, reviews, autorizações, opt-outs e `service_role`.  
**Cria:** tabelas de preparação e eventos de teste do operador; constraints de estado/canal; índices; guardas append-only e de transição; funções SECURITY DEFINER de prepare/confirm/response.  
**Segurança:** RLS habilitado; PUBLIC/anon/authenticated revogados; `service_role` recebe somente acessos e EXECUTEs allowlisted.  
**Histórico:** não sanitiza dados anteriores.  
**Reexecução:** suportada pelo runner; objetos usam criação/recriação controlada.  
**Pós-validação:** tabelas, RLS, triggers, funções, assinaturas e ACLs exatas.  
**Rollback:** restore do backup da unidade de mudança; não executar rollback isolado em produção.

### `0022_persisted_pii_audit_json`

**Dependências:** `lead_qualification_history` e `crm_timeline_events`.  
**Cria/altera:** funções de projeção PII-safe; triggers de sanitização; backfill de JSON histórico.  
**Histórico:** remove contato, nomes, notas, descrições, owners e JSON arbitrário.  
**Reexecução:** determinística e idempotente.  
**Pós-validação:** canários PII ausentes; triggers habilitados; funções sem EXECUTE público.  
**Rollback:** somente restore do backup pré-change, pois a sanitização é destrutiva por design.

### `0023_reference_only_campaign_payloads`

**Dependências:** recipients, attempts, outbox, dead letters e provider events.  
**Cria/altera:** projeção reference-only, trigger comum e cinco triggers de INSERT; backfill dos payloads.  
**Histórico:** substitui snapshots/payloads por IDs, estados e metadados allowlisted; normaliza erro de dead letter para `error_code`.  
**Reexecução:** determinística e idempotente.  
**Pós-validação:** payloads sem PII/canários; cinco triggers ativos; função sem EXECUTE público.  
**Rollback:** somente restore do backup pré-change.

### `0024_crm_idempotency_safe_results`

**Dependências:** `crm_idempotency_keys`.  
**Cria/altera:** função de resultado replay-safe, trigger e backfill do campo `result`.  
**Histórico:** remove nomes, contatos, notas, descrições e owners, preservando shape determinístico.  
**Reexecução:** determinística e idempotente.  
**Pós-validação:** replay igual à primeira resposta e ausência de canários PII.  
**Rollback:** somente restore do backup pré-change.

### `0025_narrow_contact_resolution`

**Dependências:** `pgcrypto`, 0019/0020, leads/contatos, piloto, reviews, autorizações, evidência de e-mail, opt-outs e blocos administrativos.  
**Cria/altera:** fingerprint opaco em contatos; rotação; revogações append-only; locks; função SECURITY DEFINER `resolve_narrow_contact`; preparação com fingerprint de mensagem; RLS/revokes/grants; sanitização de snapshots anteriores.  
**Preflight:** `pgcrypto` relocável; contatos sem ambiguidade; objetos 0019/0020 compatíveis.  
**Reexecução:** validada em PostgreSQL descartável; wrappers transacionais externos são removidos pelo scanner SQL do runner.  
**Pós-validação:** exatamente um contato; cross-lead/revogado/opt-out/stale/template drift bloqueados; PII não persiste.  
**Rollback:** restore integral pré-change; não remover fingerprints/revogações isoladamente.

### `0026_narrow_contact_resolution_hardening`

**Dependências:** 0025.  
**Cria/altera:** normalização de `pgcrypto` para `extensions`; unique tuple de autorização; preflight agregado de revogações incompatíveis; FK composta de revogação para autorização.  
**Condição de parada:** qualquer revogação histórica cuja tupla não corresponda à autorização.  
**Reexecução:** validada duas vezes.  
**Pós-validação:** `pgcrypto` em `extensions`; FK composta presente; readiness exige exatamente esta versão.  
**Rollback:** restore integral pré-change.

## 4. Preflight SQL obrigatório

Executar somente com identidade de migration, sem exibir PII.

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

SELECT count(*)::int AS incompatible_revocations
FROM public.contact_channel_authorization_revocations r
LEFT JOIN public.contact_channel_authorizations a
  ON a.id=r.authorization_id
 AND a.contact_id=r.contact_id
 AND a.lead_id=r.lead_id
 AND a.purpose=r.purpose
WHERE a.id IS NULL;
```

A última consulta só é executada se a tabela existir. Antes de 0025, registrar `NOT_APPLICABLE_TABLE_ABSENT`.

### Critérios PASS antes de DDL

- registries exatamente no baseline observado;
- 0019/0020 somente no registry Supabase importado;
- zero nomes 0021–0026 em ambos os registries;
- `pgcrypto_schema=extensions` ou extensão relocável que a 0026 possa normalizar;
- roles restritas ausentes ou estado integralmente reconciliável;
- backup e restore comprovados;
- Render live identificado e auto-deploy desligado.

## 5. Backup e restore

Antes de qualquer escrita hospedada:

1. registrar timestamp, projeto e SHA alvo;
2. criar backup lógico/gerenciado consistente do banco;
3. registrar identificador do backup sem expor URL ou segredo;
4. provar que o procedimento de restore está disponível;
5. congelar writes operacionais durante a janela;
6. manter export seguro de supressões/opt-outs quando aplicável;
7. definir responsável e limite de tempo para decisão de rollback.

**Stop:** sem backup verificável e procedimento de restore, `NO_GO`.

## 6. Sequência futura de execução

Esta seção exige autorização específica posterior.

1. Revalidar `main`, CI, smoke, review e zero P0/P1.
2. Revalidar Supabase e Render em modo somente leitura.
3. Confirmar backup/restore e congelamento operacional.
4. Executar o runner corrigido uma única vez com credencial de migration:
   - `0021_operator_channel_test`;
   - `0022_persisted_pii_audit_json`;
   - `0023_reference_only_campaign_payloads`;
   - `0024_crm_idempotency_safe_results`;
   - `0025_narrow_contact_resolution`;
   - `0026_narrow_contact_resolution_hardening`.
5. Validar registries e objetos após cada migration.
6. Validar readiness de banco antes de roles.
7. Criar `lead_finder_api_runtime` usando o script versionado.
8. Criar `lead_finder_contact_resolver_runtime` usando cliente transacional único, por exemplo `psql --single-transaction --set ON_ERROR_STOP=on`.
9. Executar testes positivos e negativos de privilégios.
10. Criar/rotacionar credenciais separadamente, sem registrar valores.
11. Atualizar somente a connection string da API para a role de API.
12. Manter a connection string da resolvera fora do Render e apenas no consumidor local restrito.
13. Implantar o SHA aprovado com auto-deploy desligado.
14. Validar health, readiness, SHA live, logs, RLS, grants e ausência de egress.
15. Executar fluxo sintético prepare → open → confirm → response, sem provider e sem contato real.
16. Emitir `HOSTED_HOMOLOGATION_GREEN` ou iniciar rollback.

## 7. Validação das roles

### API runtime

Deve provar:

- LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS;
- zero memberships e zero ownership;
- search path restrito e timeouts;
- SELECT somente nas três tabelas operacionais allowlisted;
- EXECUTE somente nas duas funções allowlisted;
- sem `resolve_narrow_contact`;
- sem outbox/dead-letter/lead_contacts;
- sem INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER;
- sem escrita nos dois registries;
- DDL e auto-grant negados.

### Contact resolver runtime

Deve provar:

- mesmos atributos restritos e zero memberships/ownership;
- somente USAGE no schema público necessário;
- somente EXECUTE na assinatura exata de `resolve_narrow_contact`;
- sem SELECT direto em `lead_contacts`, outbox ou tabelas de mensagens;
- sem escrita em registries;
- sem DDL;
- criação duas vezes e rollback duas vezes;
- execução dos scripts dentro de uma única transação externa.

## 8. Baseline do Render a confirmar

Esperado pelo blueprint, mas ainda não confirmado de forma autenticada:

- workspace correto;
- serviço `lead-finder-api-hml`;
- branch `hml/render-supabase-plan-b` ou sucessora explicitamente aprovada;
- SHA live exato;
- `autoDeploy=off`;
- health check `/health/ready`;
- presença, sem exibir valores, de `DATABASE_URL`, `API_AUTH_TOKEN`, `API_AUTH_PRINCIPAL_ID`, `SHADOW_EVIDENCE_HMAC_KEY` e `SHADOW_CONSENT_REGISTRY`;
- `DRY_RUN=true`;
- `SHADOW_MODE_ENABLED=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`;
- identidade PostgreSQL atual conhecida;
- health/readiness e logs sanitizados.

Sem essa evidência autenticada, o plano permanece `PREPARED_NOT_APPROVED`.

## 9. Pós-validação

```sql
SELECT version
FROM public.schema_migrations
WHERE version IN (
  '0021_operator_channel_test',
  '0022_persisted_pii_audit_json',
  '0023_reference_only_campaign_payloads',
  '0024_crm_idempotency_safe_results',
  '0025_narrow_contact_resolution',
  '0026_narrow_contact_resolution_hardening'
)
ORDER BY version;

SELECT n.nspname
FROM pg_catalog.pg_extension e
JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
WHERE e.extname='pgcrypto';

SELECT rolname, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit, rolcanlogin
FROM pg_catalog.pg_roles
WHERE rolname IN ('lead_finder_api_runtime','lead_finder_contact_resolver_runtime')
ORDER BY rolname;
```

Também validar:

- readiness retorna sucesso e exige 0026;
- nenhum canário PII em logs, auditoria, idempotência, snapshots, outbox, dead letters ou replay;
- opt-out, `DO_NOT_CONTACT` e `NAO_CONTATAR` prevalecem;
- nenhum provider/webhook/SMTP/WhatsApp API chamado;
- nenhum egress inesperado;
- exatamente zero mensagens reais.

## 10. Rollback

### Banco

Qualquer falha entre 0021 e 0026 aciona restore do backup pré-change como unidade. Não remover migrations individualmente nem apagar registros históricos para contornar constraints.

### Roles

- executar os scripts de rollback versionados em cliente transacional;
- confirmar role ausente e nenhum grant residual;
- nunca executar rollback da role em uso antes de restaurar a connection string anterior.

### Credenciais

- preservar referência segura à credencial anterior;
- restaurar a connection string anterior sem revelar valores;
- revogar a credencial nova após comprovar a reconexão anterior;
- resolvera e API são revertidas independentemente.

### Aplicação

- restaurar o SHA live anterior conhecido;
- manter auto-deploy desligado;
- validar `/health/ready`, logs e identidade do banco;
- manter providers/send/egress desligados.

## 11. Stop conditions

Interromper imediatamente em:

- divergência de qualquer registry;
- 0019/0020 ausente, duplicada ou não equivalente;
- `pgcrypto` não relocável fora de `extensions`;
- revogação histórica incompatível;
- trigger obrigatório desabilitado;
- falha ao registrar migration na mesma transação;
- role com membership, ownership, BYPASSRLS, DDL ou grant não allowlisted;
- readiness diferente do schema aplicado;
- PII/segredo em resposta, log ou artefato;
- SHA live desconhecido;
- auto-deploy ativo;
- provider, envio ou egress inesperado;
- backup/restore não comprovado;
- qualquer P0/P1 aberto.

## 12. GO/NO-GO

`GO` para solicitar autorização de execução somente quando:

- `main` exata `946cc79d8b89414a65a621b8e2996adbd8caaab1` ou sucessora exclusivamente documental;
- migrations preflight `PASS`;
- roles preflight `PASS`;
- Supabase read-only preflight `PASS`;
- Render read-only preflight `PASS` autenticado;
- rollback plan `PASS`;
- zero P0/P1;
- CI, smoke e revisão verdes;
- autorização específica do proprietário registrada.

Caso contrário:

`GO_NO_GO=NO_GO`

## 13. Estado atual

- `MIGRATIONS_PREFLIGHT=PASS`;
- `ROLES_PREFLIGHT=PASS`;
- `SUPABASE_PREFLIGHT=PASS`;
- `RENDER_PREFLIGHT=BLOCKED_AUTHENTICATED_EVIDENCE_MISSING`;
- `ROLLBACK_PLAN=PASS`;
- `HOSTED_CHANGE_PLAN_APPROVED=false`;
- `HOSTED_MUTATIONS=0`;
- `HOSTED_HOMOLOGATION_EXECUTED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`;
- `MESSAGES_SENT=0`;
- `REAL_LEADS_CONTACTED=0`.
