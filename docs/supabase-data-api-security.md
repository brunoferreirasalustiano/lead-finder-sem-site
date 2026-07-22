# Supabase — postura deny-all da Data API

## Decisão

O schema `public` do projeto de homologação permanece disponível para o proprietário do banco e para a aplicação backend que usa conexão PostgreSQL direta. Ele **não é uma API pública de dados**.

As roles de Data API `anon` e `authenticated` não possuem acesso a tabelas, sequências ou funções do schema público. Não existem policies permissivas. O comportamento esperado é fail-closed.

Não criar policies apenas para remover o aviso informativo `rls_enabled_no_policy` do Supabase Advisor.

## Autoridade versionada

A migration `0015_supabase_public_schema_hardening.sql`:

- revoga `CREATE` no schema `public` de `PUBLIC`;
- habilita RLS em todas as tabelas e tabelas particionadas públicas;
- revoga todos os privilégios de tabelas e sequências de `PUBLIC`;
- revoga todos os privilégios de tabelas e sequências de `anon` e `authenticated`;
- fixa `search_path` das funções públicas;
- revoga execução de funções de `PUBLIC`, `anon` e `authenticated`.

A migration corretiva `0017_restore_suppression_security_hardening.sql` fecha a regressão introduzida por objetos criados depois da `0015`. Ela protege `restore_suppression_runs` e `protect_restore_suppression_run()` e revoga os default privileges globais e específicos do schema `public` para o **role efetivo que executa as migrations**. Não existe suposição de que esse role se chame `postgres`: no Compose ele é normalmente `leadfinder`, enquanto o perfil Supabase pode usar outro owner autorizado.

O contrato server-side é mínimo e explícito. O owner mantém os privilégios inerentes à propriedade. Quando `service_role` já existe, a migration concede `SELECT`, `INSERT` e `UPDATE` na tabela atual, `EXECUTE` na função de proteção atual e os mesmos defaults para tabelas futuras; sequences futuras recebem `USAGE`, `SELECT` e `UPDATE`, e funções futuras recebem `EXECUTE`. A migration não cria essa role e continua válida em PostgreSQL 16 puro quando ela não existe.

As referências opcionais a `anon`, `authenticated` e `service_role` são condicionais para manter compatibilidade com PostgreSQL 16 puro. Os únicos identificadores usados nesse bloco pertencem a uma allowlist fixa; nenhum nome ou SQL vem de entrada externa.

A aplicação continua autorizada pelo papel proprietário usado na conexão PostgreSQL server-side. RLS não deve ser contornada por um cliente público ou por credencial distribuída ao navegador.

## Incidente sanitizado de 2026-07-22

Depois da aplicação da migration `0016` em homologação, a nova tabela foi observada com RLS desabilitado e grants para roles da Data API; a função associada também manteve EXECUTE público. A causa raiz foi temporal: a `0015` endurecia apenas os objetos existentes e não revogava default privileges do role efetivo das migrations. A homologação foi remediada emergencialmente e permaneceu deny-all. Este registro não contém URL de conexão, token, PII, dados de leads ou payloads.

O gate `npm run test:supabase-data-api-security` cria um banco PostgreSQL descartável com owner não-`postgres`, semeia defaults equivalentes ao perfil Supabase, aplica as migrations duas vezes, reaplica a `0017` duas vezes para comprovar idempotência e verifica RLS, ACLs, `search_path`, ausência de policies e default privileges por meio de objetos sintéticos futuros. O banco e as roles do fixture são removidos ao final.

As views `information_schema.role_table_grants` e `role_usage_grants` não são prova válida de ausência de acesso público: elas podem omitir privilégios herdados por grants a `PUBLIC`. O detector usa `pg_class.relacl` para relações e sequences e `pg_proc.proacl` para funções, expande `coalesce(acl, acldefault(...))` com `aclexplode`, identifica `PUBLIC` por `acl.grantee = 0` e associa os demais OIDs a `pg_roles` para encontrar `anon` e `authenticated`. A varredura cobre todos os objetos relevantes do schema `public`, não uma lista de nomes conhecidos.

O teste negativo concede temporariamente privilégios sintéticos a `PUBLIC`, `anon` e `authenticated`. Ele exige que o detector retorne exatamente as exposições inseridas, revoga os grants e exige uma nova passagem sem achados. Assim, um PASS não depende apenas da migration: o próprio detector demonstra que falha quando há exposição e volta a passar somente após a limpeza.

## Evidência de homologação

Verificação somente leitura executada no projeto de homologação após a migration `0015`:

- tabelas públicas: `39`;
- tabelas com RLS habilitado: `39`;
- tabelas com RLS desabilitado: `0`;
- policies no schema público: `0`;
- grants de tabela para `PUBLIC`, `anon` ou `authenticated`: `0`;
- grants de função para `PUBLIC`, `anon` ou `authenticated`: `0`;
- `CREATE` no schema público para `PUBLIC`, `anon` e `authenticated`: desabilitado;
- `USAGE` do schema para `anon` e `authenticated`: presente, mas sem privilégios de relação ou rotina.

`USAGE` no schema permite resolver nomes de objetos; não concede `SELECT`, `INSERT`, `UPDATE`, `DELETE`, uso de sequência ou execução de função. Sem grants de objeto e sem policies, a Data API permanece bloqueada.

## Caminho de acesso da aplicação

O backend usa `DATABASE_URL` e o driver PostgreSQL no servidor. A revisão do código não encontrou:

- `@supabase/supabase-js`;
- chamadas a `/rest/v1`;
- cliente de banco executado no navegador;
- chave `anon` ou `service_role` versionada.

A URL e as credenciais do banco devem permanecer somente no ambiente server-side e no gerenciador de segredos.

## Consultas de verificação

Executar somente em ambiente controlado e sem imprimir connection strings.

```sql
select
  has_schema_privilege('anon', 'public', 'USAGE') as anon_schema_usage,
  has_schema_privilege('anon', 'public', 'CREATE') as anon_schema_create,
  has_schema_privilege('authenticated', 'public', 'USAGE') as authenticated_schema_usage,
  has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_schema_create,
  has_schema_privilege('public', 'public', 'CREATE') as public_schema_create;
```

```sql
select c.relkind, c.relname,
       case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee,
       acl.privilege_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(
  coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))
) acl
left join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'));
```

```sql
select p.oid::regprocedure,
       case when acl.grantee = 0 then 'PUBLIC' else r.rolname end as grantee,
       acl.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public'
  and acl.privilege_type = 'EXECUTE'
  and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'));
```

```sql
select
  count(*) filter (where c.relrowsecurity) as rls_enabled_tables,
  count(*) filter (where not c.relrowsecurity) as rls_disabled_tables,
  count(*) as total_tables
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p');
```

```sql
select count(*) as policy_count
from pg_policies
where schemaname = 'public';
```

## Gates para qualquer mudança futura

Qualquer proposta de acesso direto pela Data API, navegador, aplicativo móvel ou ferramenta de terceiros exige:

1. threat model específico;
2. definição de identidade confiável;
3. policies RLS mínimas e testadas por role;
4. testes negativos de leitura e escrita entre usuários;
5. proteção de funções `SECURITY DEFINER` e `search_path`;
6. revisão de grants e default privileges;
7. minimização de PII;
8. auditoria de logs;
9. rotação de chaves;
10. aprovação de segurança antes do deploy.

Até esses gates existirem, o estado correto continua sendo deny-all.

## Advisor

O aviso `RLS Enabled No Policy` é informativo e esperado neste desenho. Ele deve ser revisado após migrations, mas não tratado automaticamente com criação de policies permissivas.

Advisories de severidade superior continuam bloqueando a operação e não podem ser ignorados por causa desta exceção documentada.
