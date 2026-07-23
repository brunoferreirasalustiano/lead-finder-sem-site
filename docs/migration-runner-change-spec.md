# Especificação — compatibilidade fail-closed do runner de migrations

## Contexto

O banco Supabase de homologação possui dois registros legítimos:

- `public.schema_migrations`: migrations `0001` a `0018`, aplicadas pelo runner do repositório;
- `supabase_migrations.schema_migrations`: migrations lógicas `0019` e `0020`, aplicadas pelo Supabase MCP com versões temporais.

`scripts/migrate.ts` consulta somente o primeiro registro e, no estado atual, tentaria reaplicar `0019/0020`.

## Objetivo

Alterar o runner e os verificadores para reconhecer migrations aplicadas por qualquer mecanismo aprovado, sem transformar ausência de histórico em sucesso silencioso e sem exigir o schema Supabase em PostgreSQL comum.

## Requisitos funcionais

1. Criar `public.schema_migrations` como hoje quando necessário.
2. Ler as versões locais de `public.schema_migrations.version`.
3. Detectar se o schema e a tabela `supabase_migrations.schema_migrations` existem.
4. Quando existirem, ler o campo lógico `name` sem depender da versão temporal.
5. Considerar uma migration aplicada quando o nome completo do arquivo estiver:
   - em `public.schema_migrations.version`; ou
   - em `supabase_migrations.schema_migrations.name`.
6. Não inserir automaticamente no registro local uma migration reconhecida apenas no registro Supabase.
7. Não alterar nenhum registro histórico durante uma execução de verificação.
8. Falhar quando houver:
   - nomes duplicados conflitantes;
   - migration lógica presente no registro Supabase sem objetos mínimos esperados;
   - migration presente no registro local e Supabase com identificação incompatível;
   - erro de permissão diferente de schema/tabela inexistente.
9. Emitir relatório sanitizado com a origem de cada migration: `LOCAL`, `SUPABASE` ou `BOTH`.
10. Preservar a execução transacional das migrations realmente pendentes.

## Paridade para migrations importadas

Para `0019` e `0020`, antes de aceitá-las como aplicadas via Supabase, o verificador deve conferir pelo menos:

- tabelas esperadas;
- constraints e foreign keys críticas;
- funções e triggers esperados;
- RLS ativa;
- ACL de `service_role` limitada a `SELECT` e `INSERT`;
- ausência de acesso efetivo para `PUBLIC`, `anon` e `authenticated`.

A verificação não deve expor dados de lead, contato, mensagens ou connection strings.

## Compatibilidade

- PostgreSQL comum sem schema `supabase_migrations`: comportamento atual preservado.
- Supabase com apenas registro local: comportamento atual preservado.
- Supabase com registro dividido: reconhecer a origem e impedir reaplicação.
- Banco novo: aplicar todas as migrations em ordem e registrar no histórico local.

## Testes obrigatórios

- somente registro local;
- somente registro Supabase para migrations importadas;
- registro dividido `0001–0018` local e `0019–0020` Supabase;
- registros `BOTH` compatíveis;
- nome conflitante;
- schema Supabase ausente;
- tabela Supabase inacessível;
- migration importada sem objeto obrigatório;
- segunda execução idempotente;
- nenhuma escrita durante modo de verificação;
- integração PostgreSQL descartável.

## Fora de escopo

- inserir manualmente `0019/0020` em `public.schema_migrations`;
- reaplicar migrations no banco de homologação;
- alterar objetos atuais;
- deploy no Render;
- habilitar provider, webhook, egress ou contato real.

## Critério de saída

- implementação revisada;
- testes unitários e PostgreSQL verdes;
- CI verde;
- validação somente leitura contra snapshot sanitizado da homologação;
- `scripts/migrate.ts` classifica `0019/0020` como aplicadas pelo Supabase e não executa DDL;
- issue #117 permanece bloqueada até os demais gates do ambiente efetivo.