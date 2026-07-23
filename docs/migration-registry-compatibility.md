# Compatibilidade dos registros de migrations

## Objetivo

Documentar a causa raiz do aparente desalinhamento entre o histórico nominal do repositório e os objetos de mensageria manual presentes no Supabase de homologação.

Este documento não autoriza alteração no banco, reaplicação de migration ou inserção manual de histórico.

## Evidência verificada

Projeto Supabase: `lead-finder-brasil-homologacao`.

A inspeção autenticada e somente leitura confirmou dois registros distintos:

### Registro do runner do repositório

Tabela: `public.schema_migrations`.

- contém `0001_initial` até `0018_service_role_least_privilege_reconciliation`;
- usa o nome completo do arquivo SQL como `version`;
- é consultada por `scripts/migrate.ts`.

### Registro do Supabase MCP

Tabela: `supabase_migrations.schema_migrations`.

| Migration lógica | Versão temporal | Origem registrada |
|---|---|---|
| `0019_manual_assisted_messaging` | `20260722215045` | Supabase MCP |
| `0020_manual_messaging_append_only_acl` | `20260722220522` | Supabase MCP |

Os logs PostgreSQL das últimas 24 horas registraram a aplicação via `POST /mcp` em 22 de julho de 2026 e a gravação no histórico `supabase_migrations`.

## Causa raiz

As migrations `0019` e `0020` foram aplicadas pelo mecanismo de migration do Supabase MCP. Esse mecanismo:

- usa `supabase_migrations.schema_migrations`;
- gera uma versão temporal;
- guarda o nome lógico da migration na coluna `name`.

O runner do repositório:

- usa exclusivamente `public.schema_migrations`;
- compara a coluna `version` com o nome do arquivo;
- não consulta a coluna `name` ou o registro do Supabase.

Portanto, não existe migration aplicada “sem histórico”. Existe um **registro dividido entre dois mecanismos**.

## Paridade funcional observada

A inspeção do catálogo confirmou materialmente os objetos esperados de `0019` e `0020`:

- quatro tabelas de mensageria manual;
- colunas, defaults, checks e foreign keys;
- índices;
- funções e triggers de versionamento, transição, append-only e lock de supressão;
- RLS habilitada;
- zero policies permissivas;
- zero acesso efetivo para `PUBLIC`, `anon` e `authenticated`;
- `service_role` limitado a `SELECT` e `INSERT`;
- zero registros nas tabelas manuais, em `pilot_manual_contacts` e em `campaign_opt_outs`.

Essa paridade funcional não autoriza reaplicação nem alteração de histórico.

## Risco operacional

`scripts/migrate.ts` consulta somente `public.schema_migrations`. No banco atual, ele classificaria `0019` e `0020` como pendentes e tentaria executá-las novamente.

Mesmo que parte do DDL use `IF NOT EXISTS`, a reaplicação não é aceita porque pode:

- recriar triggers;
- substituir funções;
- reaplicar grants e revogações;
- produzir comportamento diferente após mudanças futuras;
- ocultar divergências entre o arquivo atual e o SQL originalmente executado.

Até a compatibilidade ser corrigida:

- não executar `scripts/migrate.ts` contra essa homologação;
- não reaplicar `0019` ou `0020`;
- não inserir linhas manualmente em `public.schema_migrations`;
- não considerar o banco pronto para deploy controlado.

## Caminhos seguros

### Opção A — runner compatível com os dois registros

Atualizar o runner e o verificador para reconhecer uma migration lógica quando:

- o nome completo existir em `public.schema_migrations.version`; ou
- o nome lógico existir em `supabase_migrations.schema_migrations.name`.

Requisitos:

- fail-closed quando os dois registros discordarem;
- comparação de catálogo para migrations importadas;
- testes PostgreSQL para registro local, registro Supabase, duplicidade e conflito;
- nenhuma dependência obrigatória do schema Supabase em ambientes PostgreSQL comuns;
- documentação e smoke test atualizados.

### Opção B — reconciliação explícita no registro local

Inserir `0019` e `0020` em `public.schema_migrations` somente após:

- confirmar o banco exato do Render;
- preservar backup e provar restore;
- comprovar paridade funcional e origem dos registros;
- revisar a transação;
- executar em janela controlada;
- repetir catálogo, grants, RLS, contagens e advisors.

Essa opção é uma alteração de banco e não faz parte da frente documental atual.

## Recomendação

Preferir a **Opção A**, porque preserva a proveniência real das migrations aplicadas pelo Supabase e reduz a necessidade de escrever artificialmente em outro histórico.

A implementação deve manter compatibilidade com PostgreSQL comum, onde `supabase_migrations` pode não existir.

## Estado

- `MIGRATION_REGISTRY_SPLIT_VERIFIED`;
- `MIGRATION_RUNNER_COMPATIBILITY_REQUIRED`;
- `MIGRATION_REAPPLY_BLOCKED`;
- `POST_DEPLOY_GATE_BLOCKED`;
- `MESSAGES=NOT_SENT`.

## Critério de saída

O bloqueio termina somente quando uma solução revisada:

1. reconhece com segurança as migrations lógicas aplicadas pelos dois mecanismos;
2. impede reaplicação de `0019/0020`;
3. passa nos testes locais e PostgreSQL;
4. é validada contra snapshot sanitizado da homologação;
5. mantém o banco e o piloto fail-closed.