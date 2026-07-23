# Compatibilidade dos registros de migrations

## Estado

- `MIGRATION_REGISTRY_SPLIT_VERIFIED`;
- `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_GUARD_PROVED`;
- `POST_DEPLOY_GATE_BLOCKED`;
- `MESSAGES=NOT_SENT`.

Implementação concluída pela PR #121 e integrada na `main`.

Este documento não autoriza alteração no banco, reaplicação manual de migration, inserção artificial de histórico ou deploy.

## Contexto verificado

O Supabase de homologação possui dois registros legítimos:

### Registro local

Tabela: `public.schema_migrations`.

- contém `0001_initial` até `0018_service_role_least_privilege_reconciliation`;
- utiliza o nome completo do arquivo SQL como `version`;
- é mantido pelo runner do repositório.

### Registro Supabase

Tabela: `supabase_migrations.schema_migrations`.

| Migration lógica | Versão temporal | Origem |
|---|---|---|
| `0019_manual_assisted_messaging` | `20260722215045` | Supabase MCP |
| `0020_manual_messaging_append_only_acl` | `20260722220522` | Supabase MCP |

Os logs PostgreSQL registraram a aplicação via Supabase MCP em 22 de julho de 2026.

## Causa raiz

Não existia migration aplicada sem histórico. Existia um registro dividido entre dois mecanismos aprovados:

- runner do repositório: nome do arquivo em `public.schema_migrations.version`;
- Supabase MCP: versão temporal e nome lógico em `supabase_migrations.schema_migrations`.

O runner anterior consultava apenas o registro local. A PR #121 eliminou esse risco conhecido.

## Implementação concluída

O runner e os verificadores agora:

1. leem `public.schema_migrations.version`;
2. detectam opcionalmente `supabase_migrations.schema_migrations`;
3. leem `version` e `name` do registro Supabase;
4. normalizam o nome lógico da migration;
5. classificam a origem como `LOCAL`, `SUPABASE`, `BOTH` ou `PENDING`;
6. preservam PostgreSQL comum sem o schema Supabase;
7. não inserem artificialmente no registro local uma migration encontrada somente no Supabase;
8. executam apenas migrations realmente pendentes;
9. falham fechado em conflitos ou paridade insuficiente.

## Validação de paridade

Para aceitar `0019/0020` como aplicadas pelo Supabase, o runner verifica:

- quatro tabelas de mensageria manual;
- foreign keys críticas;
- triggers esperados;
- RLS habilitada;
- existência de `service_role`;
- `service_role` com somente `SELECT` e `INSERT` nas tabelas manuais;
- ausência de `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER` para `service_role`;
- ausência de acesso efetivo para `PUBLIC`, `anon` e `authenticated`.

Uma migration Supabase-only sem validador explícito é rejeitada.

## Falhas fechadas

A execução é interrompida quando:

- um nome lógico aponta para versões Supabase incompatíveis;
- uma versão temporal aponta para nomes diferentes;
- um valor de registro está vazio;
- uma migration importada não possui os objetos mínimos esperados;
- a ACL diverge do contrato;
- uma migration Supabase-only não possui validador de paridade;
- uma migration realmente pendente falha durante a transação.

## Evidências de idempotência

A CI #429 comprovou em PostgreSQL descartável:

- registro dividido `0001–0018` local e `0019–0020` Supabase;
- reconhecimento correto de `0019/0020`;
- duas execuções consecutivas do runner;
- zero inserção de `0019/0020` em `public.schema_migrations`;
- zero execução de DDL sobre migrations importadas;
- OIDs de funções e triggers preservados;
- integração, restart lógico e persistência verdes;
- validações `supabase-render` e `oracle-vps` verdes;
- restore-compose e multiarch verdes.

Deployment smoke #207 também terminou verde.

## Paridade observada no Supabase

A inspeção autenticada e somente leitura confirmou:

- tabelas, colunas, defaults, checks e foreign keys;
- índices;
- funções e triggers append-only, transição e lock de supressão;
- RLS habilitada;
- zero policies permissivas;
- zero acesso efetivo para `PUBLIC`, `anon` e `authenticated`;
- `service_role` limitado a `SELECT` e `INSERT`;
- zero registros nas tabelas manuais consultadas.

Essa inspeção não realizou escrita no banco.

## Regras permanentes

- não reaplicar `0019/0020` manualmente;
- não inserir linhas artificialmente em `public.schema_migrations`;
- não alterar objetos ou grants fora de migration revisada;
- manter validadores explícitos para migrations importadas;
- interromper a operação diante de conflito de registro ou paridade;
- preservar backup e restore antes de futuras mudanças de banco.

## Bloqueios que permanecem

A compatibilidade de migrations está concluída, mas o piloto continua bloqueado por:

- `DATABASE_URL` efetivo do Render não comprovado;
- flags efetivas do Render não comprovadas;
- SHA atual da `main` ainda não implantado;
- restart, kill switch, ausência de egress, rollback e smoke test pendentes;
- fichas privadas e supressões dos leads incompletas;
- zero canais `BUSINESS / APPROVED`;
- zero aprovações individuais para contato.

## Critério operacional

O runner pode ser incluído em um deploy controlado somente quando:

1. o banco efetivo do Render for confirmado sem exposição da connection string;
2. as flags fail-closed forem comprovadas;
3. o SHA escolhido possuir CI integralmente verde;
4. existir plano de rollback e evidência de backup/restore aplicável;
5. nenhum provider, envio ou egress externo for habilitado.
