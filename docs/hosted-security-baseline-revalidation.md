# Revalidação do baseline de segurança hospedada

**Data:** 30 de julho de 2026  
**Gate operacional:** issue #167  
**Escopo:** somente documentação e validação da árvore atual

## Baseline Git

- `main` observado antes desta PR: `9e77949bb2147d177144ed1b1e76f897fc2561fb`;
- commit funcional de segurança: `946cc79d8b89414a65a621b8e2996adbd8caaab1`, merge da PR #173;
- HEAD validado da PR #173: `4fc15817cc8a0b772fb0ae554f6873b6787fb9f5`;
- os commits administrativos posteriores `c26c8b08d7a2605c7bc3a4fc344162d825a15809` e `9e77949bb2147d177144ed1b1e76f897fc2561fb` adicionaram e removeram o mesmo arquivo temporário;
- a comparação Git entre `946cc79d8b89414a65a621b8e2996adbd8caaab1` e `9e77949bb2147d177144ed1b1e76f897fc2561fb` possui zero arquivos diferentes;
- portanto, a árvore funcional atual é a árvore integrada pela PR #173.

## Alterações funcionais validadas pela PR #173

A PR #173:

- centraliza no migration runner a propriedade da transação;
- remove wrappers externos `BEGIN`/`COMMIT` de maneira lexicalmente segura antes da execução atômica pelo runner;
- mantém aplicação do schema e escrita do registry na mesma transação;
- torna criação e rollback da role `lead_finder_contact_resolver_runtime` compatíveis com execução atômica externa;
- aplica `search_path`, `statement_timeout` e `idle_in_transaction_session_timeout` restritos à role resolver;
- adiciona testes de replay de criação e rollback da role;
- prova ausência de membership, ownership, DDL, leitura ampla e escrita nos registries;
- adiciona cobertura para comentários, literais, dollar quotes e variantes de controle transacional.

## Evidência vinculante da PR #173

- CI #698: `success` no HEAD exato `4fc15817cc8a0b772fb0ae554f6873b6787fb9f5`;
- Deployment smoke #363: `success`;
- aplicação de migrations duas vezes: `success`;
- compatibilidade dos dois registries: `success`;
- PostgreSQL, role replay, mensageria manual e narrow resolver: `success`;
- readiness, restart, PII, restore e multiarch: `success`;
- P1 do Codex sobre parsing dos wrappers: corrigido e resolvido;
- threads P0/P1 abertas: `0`.

A CI desta PR documental revalida que a árvore integrada e este registro permanecem compatíveis, mas não substitui as evidências funcionais da PR #173.

## Estado hospedado

- migrations hospedadas aplicadas: `false`;
- roles hospedadas criadas: `false`;
- deploy de homologação executado: `false`;
- providers reais habilitados: `false`;
- mensagens reais enviadas: `0`;
- leads reais contatados: `0`.

## Supabase somente leitura

Último inventário autenticado antes desta PR:

- projeto `lead-finder-brasil-homologacao` (`ondvzdvlwntrnieodifi`);
- estado `ACTIVE_HEALTHY`;
- PostgreSQL `17.6.1.147`;
- `public.schema_migrations` contém `0001`–`0018`;
- `supabase_migrations.schema_migrations` contém as migrations importadas `0019` e `0020`;
- migrations `0021`–`0026` ausentes;
- `pgcrypto` instalado no schema `extensions`;
- roles restritas ainda ausentes.

## Gates realmente restantes antes de qualquer escrita hospedada

1. baseline autenticado do Render com serviço, branch, SHA live, auto-deploy, health check, identidade PostgreSQL e kill switches comprovados;
2. evidência de backup restaurável ou procedimento equivalente formalmente aprovado para o banco de homologação;
3. execução com pós-validação e rollback conforme a autorização registrada na issue #167.

Não são bloqueios atuais:

- ordem das migrations `0021`–`0026`: confirmada;
- pré-condição de `pgcrypto`: confirmada;
- atomicidade do migration runner: validada;
- criação e rollback da role resolver: validados;
- revisão de segurança da PR #173: aprovada sem P0/P1 aberto.

Enquanto os gates hospedados permanecerem pendentes:

- `HOSTED_HOMOLOGATION_EXECUTED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`;
- `MESSAGES_SENT=0`;
- `REAL_LEADS_CONTACTED=0`.
