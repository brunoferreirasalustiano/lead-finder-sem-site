# Estado operacional consolidado

**Última revisão:** 30 de julho de 2026  
**Repositório oficial:** `brunoferreirasalustiano/lead-finder-sem-site`  
**`main` verificada:** `d0018fcdbad01cec6369ef857ef7fd59d3b38aef`  
**Gate de produção controlada:** issue #167  
**Estado técnico:** `READY_FOR_HOSTED_HOMOLOGATION`  
**Estado comercial:** `REAL_MANUAL_PILOT_BLOCKED=true`  
**Mensagens reais enviadas:** `0`

Este documento registra o baseline operacional verificável. Quando houver divergência, prevalecem o estado remoto live verificado, a `main` atual, a issue #167 e as issues específicas, nessa ordem.

## Veredito executivo

As PRs #164 e #165 foram integradas. O código atingiu `READY_FOR_HOSTED_HOMOLOGATION`, com CI e smoke verdes no ciclo aprovado, sem P1 aberto conhecido. A implementação de resolução estreita de contato e os controles de privacidade persistente estão presentes na `main` atual.

Isso não autoriza deploy, DDL hospedado, habilitação de provider ou contato real. O ambiente de homologação ainda precisa ser reconciliado de forma controlada.

Estados atuais:

- `CODEBASE_HEALTHY=true`;
- `CI_GREEN=true`;
- `SMOKE_GREEN=true`;
- `PR_164_MERGED=true`;
- `PR_165_MERGED=true`;
- `HOSTED_BASELINE_PARTIALLY_VERIFIED=true`;
- `HOSTED_MIGRATIONS_0021_TO_0025_PENDING=true`;
- `LEAD_FINDER_API_RUNTIME_ROLE_PENDING=true`;
- `LEAD_FINDER_CONTACT_RESOLVER_RUNTIME_ROLE_PENDING=true`;
- `RENDER_LIVE_SHA_NOT_REVALIDATED=true`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_SEND_ENABLED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`.

## Baseline Git e PRs

- `main`: `d0018fcdbad01cec6369ef857ef7fd59d3b38aef`, merge da PR #165;
- PR #164: integrada;
- PR #165: integrada;
- P1 aberto conhecido no gate aprovado: `0`;
- nenhuma alteração hospedada foi realizada como parte desta atualização documental.

## Supabase de homologação

Projeto verificado:

- projeto: `lead-finder-brasil-homologacao`;
- project ref: `ondvzdvlwntrnieodifi`;
- região: `sa-east-1`;
- estado: `ACTIVE_HEALTHY`;
- PostgreSQL: `17.6.1`.

Registros de migrations observados:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: contém as migrations importadas `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl`.

Regras obrigatórias:

- não reaplicar `0019` ou `0020`;
- não inserir versões artificialmente em nenhum registry;
- validar a paridade dos objetos e ACLs importados antes de avançar;
- aplicar `0021` a `0025` somente em ordem, após preflight completo;
- interromper diante de qualquer divergência de schema, grants, RLS, trigger, função ou registry;
- validar cada migration imediatamente após a aplicação;
- preservar rollback e evidência do estado anterior.

## Sequência pendente de migrations

A sequência hospedada pendente deve ser tratada como uma unidade ordenada:

1. `0021_operator_channel_test`;
2. migrations intermediárias `0022` e `0023`, conforme os arquivos presentes no SHA aprovado;
3. `0024_crm_idempotency_safe_results`;
4. `0025_narrow_contact_resolution`.

A migration `0024` é o gate mínimo de readiness esperado pela aplicação para privacidade dos resultados de idempotência CRM. A migration `0025` adiciona a resolução estreita de contato, revogações de autorização, locks transacionais e a função `resolve_narrow_contact`.

Nenhuma migration dessa sequência deve ser aplicada isoladamente sem conferir dependências, transação, reexecução, pós-validação e rollback.

## Roles PostgreSQL de privilégio mínimo

As roles abaixo ainda não foram comprovadas no ambiente hospedado:

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

Antes de qualquer troca no Render, os scripts de criação e rollback e os testes negativos devem passar em PostgreSQL descartável ou ambiente equivalente controlado.

## Segurança e fronteira de dados

Continuam obrigatórios:

- RLS habilitado nas tabelas internas sensíveis;
- ausência de policies permissivas para `anon` e `authenticated`;
- `service_role` limitado aos privilégios explicitamente necessários;
- histórico manual append-only;
- opt-out, `DO_NOT_CONTACT` e `NAO_CONTATAR` preservados;
- kill switches mantidos;
- PII não publicada em logs, issues, PRs ou documentação;
- contato resolvido somente no fluxo estreito, auditado e autorizado.

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

1. SHA exato da `main` aprovada;
2. CI e smoke verdes no SHA alvo;
3. backup e procedimento de restore;
4. registries de migration reconciliados;
5. matriz `0021–0025` com dependências, pós-validação e rollback;
6. scripts das roles com testes positivos e negativos;
7. Render com auto-deploy desligado e SHA live conhecido;
8. providers e envio real desligados;
9. ausência de egress não autorizado;
10. stop conditions registradas.

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