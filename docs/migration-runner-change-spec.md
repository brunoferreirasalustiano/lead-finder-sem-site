# Registro de implementação — compatibilidade fail-closed do runner de migrations

## Estado

Implementado pela PR #121, integrado na `main` e validado pela CI #429.

- `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_GUARD_PROVED`;
- issue #120 concluída.

## Contexto

O Supabase de homologação possui dois registros legítimos:

- `public.schema_migrations`: migrations `0001` a `0018`, aplicadas pelo runner do repositório;
- `supabase_migrations.schema_migrations`: migrations lógicas `0019` e `0020`, aplicadas pelo Supabase MCP com versões temporais.

O runner anterior consultava somente o primeiro registro e poderia classificar `0019/0020` como pendentes.

## Objetivo alcançado

O runner e os verificadores reconhecem migrations aplicadas por qualquer mecanismo aprovado, sem transformar ausência de histórico em sucesso silencioso e sem exigir o schema Supabase em PostgreSQL comum.

## Comportamento implementado

1. `public.schema_migrations` continua sendo criada quando necessário.
2. As versões locais são lidas de `public.schema_migrations.version`.
3. A existência de `supabase_migrations.schema_migrations` é detectada de forma opcional.
4. Quando presente, o campo lógico `name` e a versão temporal são lidos.
5. A origem de cada migration é classificada como:
   - `LOCAL`;
   - `SUPABASE`;
   - `BOTH`;
   - `PENDING`.
6. Uma migration reconhecida somente no Supabase não é inserida automaticamente no registro local.
7. A leitura e a verificação não alteram registros históricos.
8. Migrations realmente pendentes continuam transacionais.
9. Conflitos e paridade insuficiente interrompem a execução.

## Falhas fechadas implementadas

O runner rejeita:

- nome lógico vazio;
- versão Supabase vazia;
- um nome lógico associado a versões incompatíveis;
- uma versão temporal associada a nomes diferentes;
- migration Supabase-only sem validador explícito;
- migration importada sem objetos mínimos;
- RLS, triggers, foreign keys ou ACL incompatíveis.

## Paridade de `0019/0020`

Antes de aceitá-las como aplicadas via Supabase, o runner confere:

- tabelas esperadas;
- foreign keys críticas;
- triggers esperados;
- RLS ativa;
- existência de `service_role`;
- `service_role` limitado a `SELECT` e `INSERT`;
- ausência de privilégios de mutação destrutiva;
- ausência de acesso efetivo para `PUBLIC`, `anon` e `authenticated`.

A verificação não expõe dados de lead, contato, mensagem ou connection string.

## Compatibilidade comprovada

- PostgreSQL comum sem schema `supabase_migrations`;
- banco com apenas registro local;
- Supabase com registro dividido;
- registros `BOTH` compatíveis;
- banco novo com migrations pendentes.

## Testes concluídos

- somente registro local;
- somente registro Supabase para migrations importadas;
- registro dividido `0001–0018` local e `0019–0020` Supabase;
- registros `BOTH` compatíveis;
- nomes e versões conflitantes;
- valores vazios;
- schema Supabase ausente;
- migration importada sem objeto obrigatório;
- segunda execução idempotente;
- nenhuma escrita artificial no histórico local;
- ausência de DDL sobre migrations importadas;
- integração PostgreSQL descartável;
- restart lógico e persistência;
- restore-compose;
- multiarch.

## Evidência de não reaplicação

O teste PostgreSQL executa o runner duas vezes no mesmo banco e comprova:

- `0019/0020` reconhecidas pelo nome lógico;
- nenhuma linha artificial adicionada ao registro local;
- funções e triggers com OIDs preservados;
- migrations importadas não executam DDL;
- estado persistido permanece íntegro após restart lógico.

## Fora de escopo preservado

- inserir manualmente `0019/0020` em `public.schema_migrations`;
- reaplicar migrations no Supabase real;
- alterar objetos atuais da homologação durante a validação;
- deploy no Render;
- habilitar provider, webhook, egress ou contato real.

## Bloqueios posteriores à implementação

A issue #117 permanece bloqueada até:

- confirmação do `DATABASE_URL` e das flags efetivas do Render;
- deploy controlado de SHA aprovado;
- logs e health checks pós-deploy;
- restart, kill switch, ausência de egress, rollback e smoke test;
- qualificação privada e supressões por lead;
- aprovação individual do primeiro lote.

Esta implementação remove exclusivamente o bloqueio de compatibilidade do runner. Não autoriza envio real.
