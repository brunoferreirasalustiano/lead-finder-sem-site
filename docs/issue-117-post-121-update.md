# Atualização do gate #117 após a PR #121

**Data:** 23 de julho de 2026  
**Baseline integrada:** `347e0387a8025ab406aeb3b58c4dcd30940ff865`

Este adendo substitui, até a próxima consolidação integral, todas as referências nos documentos operacionais que ainda tratem a compatibilidade do runner de migrations como pendente.

## Progresso comprovado

A PR #121 foi integrada na `main` e encerrou a issue #120.

Evidências verificadas:

- CI #429 integralmente verde;
- Deployment smoke #207 verde;
- leitura conjunta de `public.schema_migrations` e `supabase_migrations.schema_migrations`;
- reconhecimento de `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl` pelo nome lógico;
- classificação de origem `LOCAL`, `SUPABASE`, `BOTH` ou `PENDING`;
- rejeição fail-closed de nomes ou versões incompatíveis;
- rejeição de migration Supabase-only sem validador explícito;
- validação de tabelas, foreign keys, triggers, RLS e ACL antes de aceitar `0019/0020` como aplicadas;
- segunda execução idempotente em PostgreSQL descartável;
- zero inserção artificial de `0019/0020` em `public.schema_migrations`;
- ausência de DDL sobre funções e triggers protegidos comprovada por OID.

Estados substituídos:

- `MIGRATION_RUNNER_COMPATIBILITY_REQUIRED` → `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_BLOCKED` → `MIGRATION_REAPPLY_GUARD_PROVED`.

## Bloqueios que permanecem

A integração da PR #121 não autoriza deploy nem contato real. Permanecem pendentes:

- confirmar que o `DATABASE_URL` efetivo do Render corresponde ao projeto Supabase inspecionado;
- confirmar as flags efetivas do serviço Render;
- implantar um SHA aprovado com CI verde;
- revisar logs sanitizados após o deploy;
- comprovar restart, kill switch, ausência observada de egress, rollback e smoke test;
- concluir fichas privadas dos códigos LF-TM prioritários;
- classificar no máximo cinco canais como `BUSINESS / APPROVED` ou rejeitar;
- consultar opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueios por lead vinculado;
- obter aprovação individual de Bruno F. Salustiano por lead.

## Estado operacional preservado

- `POST_DEPLOY_GATE_BLOCKED`;
- `REAL_MANUAL_PILOT_BLOCKED`;
- `MESSAGES=NOT_SENT`;
- contatos enviados: `0`;
- providers reais: desligados;
- LGPD, opt-out, `DO_NOT_CONTACT` e `NAO_CONTATAR`: preservados.

Nenhuma operação contra o Supabase real ou o Render foi executada durante a implementação, validação ou integração da PR #121.
