# Estado operacional consolidado

**Última revisão:** 30 de julho de 2026  
**Repositório oficial:** `brunoferreirasalustiano/lead-finder-sem-site`  
**Baseline de runtime verificada:** `53fa744dd0cfdfaa43e6690e94c2697df9b55af9`  
**Gate de produção controlada:** issue #167  
**Estado técnico:** `READY_FOR_HOSTED_HOMOLOGATION`  
**Estado comercial:** `REAL_MANUAL_PILOT_BLOCKED=true`  
**Mensagens reais enviadas:** `0`

Este documento registra o baseline operacional verificável. Quando houver divergência, prevalecem o estado remoto live verificado, a `main` atual, a issue #167 e as issues específicas, nessa ordem.

## Veredito executivo

As PRs #164, #165 e #166 foram integradas. O código atingiu `READY_FOR_HOSTED_HOMOLOGATION`, com CI, smoke, revisão independente e hardening pós-merge aprovados, sem P0 ou P1 aberto conhecido.

A baseline de runtime contém:

- controles de privacidade persistente e projeções PII-safe;
- runtime PostgreSQL de privilégio mínimo;
- resolução estreita de exatamente um contato autorizado;
- replay histórico compatível;
- integridade do fingerprint da mensagem renderizada;
- EMAIL fail-closed enquanto não existe consumidor local restrito;
- vínculo composto entre autorização e revogação;
- normalização controlada do `pgcrypto` para o schema `extensions`;
- readiness exigindo a migration `0026_narrow_contact_resolution_hardening`.

Isso não autoriza deploy, DDL hospedado, alteração de roles ou credenciais hospedadas, habilitação de provider, uso de dados reais ou contato real. O ambiente de homologação ainda precisa ser reconciliado e atualizado de forma controlada.

Estados atuais:

- `CODEBASE_HEALTHY=true`;
- `CI_GREEN=true`;
- `SMOKE_GREEN=true`;
- `PR_164_MERGED=true`;
- `PR_165_MERGED=true`;
- `PR_166_MERGED=true`;
- `KNOWN_P0_OPEN=0`;
- `KNOWN_P1_OPEN=0`;
- `HOSTED_BASELINE_PARTIALLY_VERIFIED=true`;
- `HOSTED_MIGRATIONS_0021_TO_0026_PENDING=true`;
- `LEAD_FINDER_API_RUNTIME_ROLE_PENDING=true`;
- `LEAD_FINDER_CONTACT_RESOLVER_RUNTIME_ROLE_PENDING=true`;
- `RENDER_LIVE_SHA_NOT_REVALIDATED=true`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_SEND_ENABLED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`.

## Baseline Git e PRs

- baseline de runtime integrada na `main`: `53fa744dd0cfdfaa43e6690e94c2697df9b55af9`, merge da PR #166;
- a `main` pode avançar por sucessor exclusivamente documental sem alterar essa árvore de runtime;
- PR #164: integrada no commit `728b8748f1f9d0bf47a527cf0d744fa42ec99030`;
- PR #165: integrada no commit `d0018fcdbad01cec6369ef857ef7fd59d3b38aef`;
- PR #166: integrada no commit `53fa744dd0cfdfaa43e6690e94c2697df9b55af9`;
- CI #679: sucesso no HEAD final da PR #166;
- CI pós-Ready #680: sucesso no mesmo HEAD;
- Deployment smoke #351: sucesso;
- revisão final do Codex: nenhum problema relevante no HEAD final;
- threads P0/P1 abertas conhecidas: `0`;
- nenhuma alteração hospedada foi realizada para alcançar este baseline.

## Supabase de homologação

Projeto previamente verificado:

- projeto: `lead-finder-brasil-homologacao`;
- project ref: `ondvzdvlwntrnieodifi`;
- região: `sa-east-1`;
- estado anteriormente observado: `ACTIVE_HEALTHY`;
- PostgreSQL anteriormente observado: `17.6.1`.

Esses dados precisam ser revalidados imediatamente antes de qualquer escrita hospedada.

Registros de migrations anteriormente observados:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: contém as migrations importadas `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl`.

Regras obrigatórias:

- revalidar os dois registries antes de qualquer DDL;
- não reaplicar `0019` ou `0020`;
- não inserir versões artificialmente em nenhum registry;
- validar a paridade dos objetos e ACLs importados antes de avançar;
- aplicar `0021` a `0026` somente em ordem, após preflight completo;
- interromper diante de qualquer divergência de schema, grants, RLS, trigger, função, extensão ou registry;
- validar cada migration imediatamente após a aplicação;
- preservar backup, rollback e evidência do estado anterior.

## Sequência pendente de migrations

A sequência hospedada pendente deve ser tratada como uma unidade ordenada:

1. `0021_operator_channel_test`;
2. `0022_persisted_pii_audit_json`;
3. `0023_reference_only_campaign_payloads`;
4. `0024_crm_idempotency_safe_results`;
5. `0025_narrow_contact_resolution`;
6. `0026_narrow_contact_resolution_hardening`.

Os identificadores acima são os basenames exatos registrados pelo migration runner.

Funções dos gates finais:

- `0024` protege resultados persistentes de idempotência CRM;
- `0025` adiciona resolução estreita, fingerprints opacos, revogações, locks e `resolve_narrow_contact`;
- `0026` normaliza `pgcrypto`, vincula revogações à tupla exata de autorização e passa a ser a migration mínima exigida pelo readiness da aplicação.

A migration `0026` faz preflight de revogações históricas e falha fechado caso encontre uma tupla incompatível. Esse resultado exige reconciliação controlada; nunca deve ser contornado apagando histórico ou reduzindo constraints.

Nenhuma migration dessa sequência deve ser aplicada isoladamente sem conferir dependências, transação, reexecução, pós-validação e rollback.

## Roles PostgreSQL de privilégio mínimo

As roles abaixo ainda não foram comprovadas no ambiente hospedado após a migration 0026:

- `lead_finder_api_runtime`;
- `lead_finder_contact_resolver_runtime`.

Requisitos invariáveis:

- não ser owner, superuser ou possuir `BYPASSRLS`;
- não possuir `CREATEDB`, `CREATEROLE` ou `REPLICATION`;
- não receber DDL;
- receber `USAGE` somente nos schemas necessários;
- receber acesso somente às tabelas e funções allowlisted;
- a role de API não deve executar `resolve_narrow_contact`;
- somente a role de resolução deve receber `EXECUTE` em `resolve_narrow_contact`;
- nenhuma role de runtime deve escrever nos registries de migration;
- credenciais de runtime devem ser separadas das credenciais de migration e restore.

Antes de qualquer troca no Render, os scripts de criação e rollback e os testes positivos e negativos devem passar em PostgreSQL descartável ou ambiente equivalente controlado.

## Segurança e fronteira de dados

Continuam obrigatórios:

- RLS habilitado nas tabelas internas sensíveis;
- ausência de policies permissivas para `anon` e `authenticated`;
- `service_role` limitado aos privilégios explicitamente necessários;
- histórico manual e revogações append-only;
- revogação vinculada à mesma autorização, contato, lead e propósito;
- opt-out, `DO_NOT_CONTACT` e `NAO_CONTATAR` preservados;
- kill switches mantidos;
- PII não publicada em logs, issues, PRs ou documentação;
- contato resolvido somente no fluxo estreito, auditado e autorizado;
- conteúdo local renderizado validado pelo fingerprint antes do registro `OPENED` e da abertura do WhatsApp;
- EMAIL bloqueado com `EMAIL_CONSUMER_UNAVAILABLE` enquanto não existir consumidor local restrito;
- nenhuma fallback automática de contato ou canal.

Avisos `RLS_ENABLED_NO_POLICY` do Supabase Advisor são compatíveis com o desenho deny-all para tabelas internas, desde que `anon` e `authenticated` permaneçam sem privilégios e nenhuma policy permissiva seja introduzida.

## Render de homologação

Estado previamente conhecido, ainda exigindo revalidação autenticada:

- workspace: `Bruno's workspace`;
- serviço esperado: `lead-finder-api-hml`;
- auto-deploy esperado: `off`;
- health check esperado: `/health/ready`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`.

O SHA live, a branch implantada, as variáveis efetivas, os grants usados pelo runtime e o estado de readiness devem ser comprovados antes e depois de qualquer deploy controlado.

## Gate de homologação hospedada

Antes de qualquer escrita hospedada, comprovar:

1. baseline de runtime aprovada: `53fa744dd0cfdfaa43e6690e94c2697df9b55af9`, ou sucessor exclusivamente documental sem mudança da árvore de runtime;
2. CI e smoke verdes no SHA/árvore de código alvo;
3. backup e procedimento de restore;
4. registries de migration reconciliados;
5. matriz `0021–0026` com dependências, preflight, pós-validação e rollback;
6. estado e schema efetivo do `pgcrypto`;
7. ausência de revogações históricas com tupla incompatível;
8. scripts das roles com testes positivos e negativos;
9. Render com auto-deploy desligado e SHA live conhecido;
10. providers e envio real desligados;
11. ausência de egress não autorizado;
12. stop conditions registradas.

Qualquer falha preserva `REAL_MANUAL_PILOT_BLOCKED=true`.

## Preparação do piloto manual

Somente após a homologação hospedada aprovada:

- validar health, readiness, SHA live e logs;
- validar grants reais das roles;
- validar restart e rollback;
- executar teste fechado somente com dados pertencentes ao operador;
- confirmar ausência de provider e envio automático;
- emitir GO/NO-GO separado para o primeiro contato manual real.

Mesmo com homologação aprovada, nenhum lead real pode ser contatado sem revisão humana individual, canal permitido, autorização aplicável, opt-out verificado e gate explícito `REAL_MANUAL_PILOT_READY`.

## Regras invariáveis

Continuam desligados:

- WhatsApp Cloud API;
- SMTP/provider de e-mail para campanhas;
- webhooks de envio;
- follow-ups automáticos;
- n8n para campanhas reais;
- automação de WhatsApp Web;
- qualquer envio comercial automático.

Nunca publicar:

- tokens, senhas ou connection strings;
- telefone ou e-mail de lead;
- mensagem integral associada a lead real;
- payload bruto ou snapshots com PII;
- prints com PII;
- chaves HMAC ou valores de secrets.

Toda mudança de arquitetura, ambiente, segurança, provider, piloto ou estado operacional deve atualizar este documento, a issue #167 e as issues específicas.
