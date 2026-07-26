# Estado operacional consolidado

**Última revisão:** 25 de julho de 2026  
**`main` aprovada:** `35e1b2087abd61aa9b407afa1536259d4c8226a8`  
**Branch HML:** `hml/render-supabase-plan-b`  
**HEAD HML após PR #143:** `1c61444809cbe7b33def071bb1bd352c6234906e`  
**Gate central:** issue #117  
**Estado comercial:** `REAL_MANUAL_PILOT_BLOCKED=true`  
**Mensagens:** `NOT_SENT`  
**Contatos enviados:** `0`

Este documento contém o estado operacional verificável atual. Pull requests, issues, migrations, CI e inspeções autenticadas preservam as evidências detalhadas.

## Veredito executivo

A base de código está íntegra, testada e sincronizada com a branch de homologação. O núcleo persistente `OPERATOR_TEST` está implementado e endurecido, mas ainda não está disponível de ponta a ponta no ambiente hospedado.

O projeto não está quebrado, porém não está autorizado para operação comercial real.

Estados:

- `CODEBASE_HEALTHY`;
- `CI_GREEN`;
- `MAIN_HML_SYNCED`;
- `OPERATOR_TEST_CORE_READY`;
- `OPERATOR_TEST_END_TO_END_NOT_READY`;
- `RENDER_NEW_CODE_NOT_DEPLOYED`;
- `MIGRATION_0021_NOT_APPLIED`;
- `LEAST_PRIVILEGE_DATABASE_ROLE_PENDING`;
- `REAL_MANUAL_PILOT_BLOCKED`;
- `MESSAGES_NOT_SENT`.

## Baseline técnica atual

PRs recentes integradas:

- PR #139 — atualização do toolchain de desenvolvimento e audit sem vulnerabilidades;
- PR #141 — console local isolada para operação manual de WhatsApp;
- PR #140 — núcleo persistente, append-only e fail-closed `OPERATOR_TEST`;
- PR #142 — sincronização da console local na HML;
- PR #143 — sincronização do núcleo endurecido `OPERATOR_TEST` na HML.

A branch HML contém todo o conteúdo atual da `main` e preserva apenas commits administrativos próprios. A comparação após a PR #143 apresentou `behind_by=0` e nenhuma diferença de arquivos em relação à `main`.

## Evidência de CI

A CI #548 foi concluída com sucesso após a integração das mudanças atuais.

Aprovado:

- `npm ci`;
- typecheck;
- lint;
- testes unitários;
- cobertura;
- build;
- audit de dependências;
- `git diff --check`;
- validação dos perfis `supabase-render` e `oracle-vps`;
- aplicação dupla das migrations em PostgreSQL descartável;
- compatibilidade dos registros local e Supabase de migrations;
- Data API deny-all;
- mensageria manual assistida;
- `OPERATOR_TEST` em PostgreSQL;
- gate sintético de lote;
- reconciliação de supressões;
- segundo passe de prontidão;
- persistência após restart lógico;
- restore-compose;
- API e worker em AMD64 e ARM64;
- manifests multiarch.

Os testes são sintéticos ou executados em infraestrutura descartável. Nenhuma mensagem real foi enviada.

## Segurança do núcleo `OPERATOR_TEST`

Implementado pela migration incremental `0021_operator_channel_test.sql` e pelo módulo de banco correspondente.

Controles comprovados:

- propósito fixo `OPERATOR_TEST`;
- canal fixo `WHATSAPP`;
- template fixo `operator-whatsapp-channel-test` versão `v1`;
- telefone, principal e chave de idempotência protegidos por HMAC-SHA256 com separação de domínio;
- persistência somente de UUIDs, enums, timestamps e fingerprints escalares;
- ausência de telefone, mensagem, URL, principal e idempotency key em formato bruto;
- FK composta vinculando cada evento ao mesmo principal da preparação;
- histórico append-only;
- transições protegidas no serviço e no PostgreSQL;
- locks transacionais e constraints para idempotência e concorrência;
- `service_role` sem `INSERT` direto nas tabelas;
- escrita somente por funções SQL allowlisted;
- `search_path` fixo;
- `PUBLIC`, `anon` e `authenticated` sem acesso;
- testes negativos de PII e inspeção integral dos registros persistidos.

Sequência permitida:

`PREPARED → OPENED → CONTACT_CONFIRMED → RESPONSE_RECORDED`

Regras:

- confirmação exige `OPENED`;
- resposta exige `SENT_CONFIRMED`;
- `NOT_SENT` não pode produzir resposta;
- replays divergentes e estados contraditórios falham fechados.

## Limitação arquitetural do banco

A homologação ainda utiliza uma conexão PostgreSQL privilegiada. Um proprietário do banco pode ultrapassar grants, alterar funções ou modificar objetos.

Antes de ativar o novo fluxo hospedado, criar uma role dedicada de runtime com privilégio mínimo, sem poderes de owner, DDL ou bypass de RLS.

A role deve possuir somente:

- conexão ao banco correto;
- `USAGE` nos schemas necessários;
- `SELECT` estritamente necessário;
- `EXECUTE` nas funções allowlisted;
- nenhuma permissão direta de `INSERT`, `UPDATE` ou `DELETE` nas tabelas `OPERATOR_TEST`;
- nenhuma permissão de criação ou alteração de objetos.

Nenhuma alteração de credencial ou role foi realizada pelas PRs #140–#143.

## Supabase de homologação

Projeto: `lead-finder-brasil-homologacao`  
Project ref: `ondvzdvlwntrnieodifi`  
Região: `sa-east-1`  
Estado previamente observado: `ACTIVE_HEALTHY`

Comprovado:

- `DATABASE_URL` do Render corresponde ao projeto de homologação;
- senha do banco foi rotacionada após exposição acidental;
- connection string do Render foi atualizada;
- `/health/live` retornou HTTP 200;
- `/health/ready` retornou HTTP 200 com `status=ready`;
- endpoint interno sem token retornou HTTP 401;
- nenhum erro recente foi observado após a rotação;
- incidente de credencial encerrado.

Não registrar neste repositório a connection string, senha, token ou valores equivalentes.

Registros de migration previamente comprovados:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: `0019` e `0020`.

Regras permanentes:

- não reaplicar `0019/0020` manualmente;
- não inserir versões artificialmente no registro local;
- interromper diante de conflito entre os registros;
- aplicar `0021` somente por procedimento revisado, transacional e reversível;
- validar objetos, grants, RLS e histórico imediatamente após a aplicação.

A migration `0021` ainda não foi aplicada no Supabase hospedado.

## Render de homologação

Serviço:

- workspace: `Bruno's workspace`;
- serviço: `lead-finder-api-hml`;
- branch: `hml/render-supabase-plan-b`;
- auto-deploy: `off`;
- health check: `/health/ready`;
- região: Virginia.

Valores efetivos verificados manualmente:

- `DEPLOYMENT_PROFILE=supabase-render`;
- `NODE_ENV=production`;
- `DRY_RUN=true`;
- `SHADOW_MODE_ENABLED=true`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`;
- `API_AUTH_PERMISSIONS=pilot:read`;
- `CORS_ALLOWED_ORIGINS` em origem deliberadamente inválida para acesso browser fail-closed.

Secrets configurados sem divulgação de valores:

- `DATABASE_URL`;
- `API_AUTH_TOKEN`;
- `INTERNAL_CRON_SECRET`.

A identidade exata do deploy realizado durante a rotação da credencial não foi preservada como evidência confiável. Portanto, não afirmar que o Render executa o SHA atual da HML.

Estados:

- `RENDER_CONFIGURATION_FAIL_CLOSED`;
- `RENDER_AUTO_DEPLOY_OFF`;
- `RENDER_DATABASE_TARGET_VERIFIED`;
- `RENDER_LIVE_CODE_IDENTITY_NOT_VERIFIED`;
- `RENDER_NEW_OPERATOR_TEST_CODE_NOT_DEPLOYED`.

## Integração ponta a ponta pendente

A PR #140 não incluiu:

- rotas HTTP da API para `OPERATOR_TEST`;
- parser das novas configurações;
- matriz de autorização das novas rotas;
- ligação da console local com o núcleo persistente;
- configuração dos secrets específicos de fingerprint;
- aplicação da migration `0021` no Supabase;
- deploy do código novo no Render;
- teste manual hospedado.

Criar uma PR separada para essa integração. Ela deve permanecer fail-closed e não pode reutilizar as permissões do piloto comercial.

Permissões previstas:

- `operator-test:prepare`;
- `operator-test:open`;
- `operator-test:confirm`;
- `operator-test:response`.

O escopo deve continuar isolado de leads, campanhas, piloto comercial, outbox e providers.

## Piloto comercial

O piloto permanece bloqueado independentemente do teste fechado do operador.

Pendências:

- recuperar ou reconstruir o mapeamento privado dos candidatos;
- concluir até cinco fichas privadas;
- confirmar identidade, atividade, região e diagnóstico;
- classificar canal como `BUSINESS / APPROVED` ou rejeitar;
- obter opt-in válido para WhatsApp;
- consultar opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueios por lead;
- aplicar rubrica mínima `8/10`, sem dimensão em zero;
- obter aprovação individual de Bruno F. Salustiano;
- emitir veredito explícito `REAL_MANUAL_PILOT_READY`.

`BUSINESS_CANDIDATE` não autoriza contato.

## Performance futura

A revisão dos advisors identificou foreign keys sem índice de cobertura. Isso não bloqueia o primeiro lote pequeno, mas deve ser analisado antes de ampliar volume.

Não criar ou remover índices apenas com base em advisors de um banco quase vazio. Exigir plano de consulta, padrão de acesso e benchmark.

Issue de acompanhamento: #134.

## Próxima sequência autorizável

1. reconciliar issues #92, #117 e #135 com este estado;
2. criar plano e issue para role PostgreSQL de privilégio mínimo;
3. implementar em PR isolada as rotas e configurações `OPERATOR_TEST`;
4. validar CI integralmente;
5. preparar aplicação transacional da migration `0021` e rollback;
6. preparar deploy manual do SHA aprovado, sem auto-deploy;
7. executar somente após checklist e autorização operacional final;
8. validar health, logs, ACLs, PII, kill switch, restart e ausência de egress;
9. realizar um único teste fechado com destino pertencente ao operador;
10. manter leads reais e mensagens comerciais bloqueados.

## Regras invariáveis

Continuam desligados:

- WhatsApp Cloud API;
- SMTP/provider de e-mail;
- OpenAI para rascunhos;
- webhooks;
- follow-ups automáticos;
- n8n para campanhas reais;
- qualquer automação de WhatsApp Web.

Nunca publicar:

- tokens ou senhas;
- connection strings;
- telefone ou e-mail de lead;
- mensagem integral;
- payload bruto;
- prints com PII.

Toda alteração de arquitetura, ambiente, segurança, provider, piloto ou estado deve atualizar este documento, as issues relacionadas e as evidências de CI.
