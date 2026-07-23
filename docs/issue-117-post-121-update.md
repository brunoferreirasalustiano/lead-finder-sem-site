# Atualização do gate #117 após as PRs #121 e #122

**Data:** 23 de julho de 2026  
**Baseline integrada:** `d45c2b47cbd7e1787623fa992d9d3b727daea964`

Este adendo registra a remoção de dois bloqueios técnicos: compatibilidade do runner de migrations e vulnerabilidade alta na dependência transitiva `find-my-way`.

## Compatibilidade de migrations

A PR #121 foi integrada na `main` e encerrou a issue #120.

Evidências:

- CI #429 integralmente verde;
- Deployment smoke #207 verde;
- leitura conjunta de `public.schema_migrations` e `supabase_migrations.schema_migrations`;
- reconhecimento de `0019_manual_assisted_messaging` e `0020_manual_messaging_append_only_acl` pelo nome lógico;
- classificação `LOCAL`, `SUPABASE`, `BOTH` ou `PENDING`;
- rejeição fail-closed de nomes ou versões incompatíveis;
- rejeição de migration Supabase-only sem validador explícito;
- validação de tabelas, foreign keys, triggers, RLS e ACL;
- segunda execução idempotente em PostgreSQL descartável;
- zero inserção artificial no histórico local;
- ausência de DDL sobre funções e triggers protegidos, comprovada por OID.

Estados:

- `MIGRATION_RUNNER_COMPATIBILITY_COMPLETE`;
- `MIGRATION_REAPPLY_GUARD_PROVED`.

## Segurança de dependências

A PR #122 atualizou `find-my-way 9.6.0 → 9.7.0` no lockfile.

Evidências:

- advisory alto `GHSA-c96f-x56v-gq3h` identificado;
- correção lockfile-only;
- sem `npm audit fix --force`;
- único arquivo final alterado: `package-lock.json`;
- CI #438 integralmente verde;
- audit verde nos perfis `oracle-vps` e `supabase-render`;
- integração, restore-compose e multiarch verdes.

Estado: `DEPENDENCY_AUDIT_CLEAN`.

## Bloqueios que permanecem

As integrações das PRs #121 e #122 não autorizam deploy nem contato real. Permanecem pendentes:

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

Nenhuma operação contra o Supabase real ou o Render foi executada durante essas implementações, validações ou integrações.
