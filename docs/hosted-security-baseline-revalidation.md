# Revalidação do baseline de segurança hospedada

**Data:** 30 de julho de 2026  
**Gate operacional:** issue #167  
**Escopo:** somente documentação e validação da árvore atual

## Baseline Git

- `main` observado antes desta PR: `9e77949bb2147d177144ed1b1e76f897fc2561fb`;
- commit funcional de segurança: `946cc79d8b89414a65a621b8e2996adbd8caaab1`;
- os commits administrativos posteriores `c26c8b08d7a2605c7bc3a4fc344162d825a15809` e `9e77949bb2147d177144ed1b1e76f897fc2561fb` adicionaram e removeram o mesmo arquivo temporário;
- a comparação Git entre `946cc79d8b89414a65a621b8e2996adbd8caaab1` e `9e77949bb2147d177144ed1b1e76f897fc2561fb` possui zero arquivos diferentes;
- portanto, a árvore funcional atual é a árvore de `946cc79d8b89414a65a621b8e2996adbd8caaab1`.

## Alterações funcionais do commit de segurança

O commit `946cc79d8b89414a65a621b8e2996adbd8caaab1`:

- centraliza no migration runner a propriedade da transação;
- remove wrappers externos `BEGIN`/`COMMIT` de maneira lexicalmente segura antes da execução atômica pelo runner;
- mantém aplicação do schema e escrita do registry na mesma transação;
- torna criação e rollback da role `lead_finder_contact_resolver_runtime` compatíveis com execução atômica externa;
- aplica `search_path`, `statement_timeout` e `idle_in_transaction_session_timeout` restritos à role resolver;
- adiciona testes de replay de criação e rollback da role;
- prova ausência de membership, ownership, DDL, leitura ampla e escrita nos registries;
- adiciona cobertura para comentários, literais, dollar quotes e variantes de controle transacional.

## Evidência atual

- deployment smoke pós-merge do commit funcional: `success`;
- CI completa de pull request para esta árvore: pendente nesta PR;
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

## Gates restantes antes de qualquer escrita hospedada

1. CI completa verde sobre a árvore funcional atual;
2. revisão de segurança sem P0/P1 aberto;
3. baseline autenticado do Render com serviço, branch, SHA live, auto-deploy, health check e kill switches comprovados;
4. evidência de backup restaurável ou procedimento equivalente aprovado para o banco de homologação;
5. autorização preservada para a sequência controlada `0021`–`0026`, roles, identidade de runtime e deploy;
6. pós-validação e rollback executáveis.

Enquanto qualquer gate permanecer pendente:

- `HOSTED_HOMOLOGATION_EXECUTED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`;
- `MESSAGES_SENT=0`;
- `REAL_LEADS_CONTACTED=0`.
