# Estado operacional consolidado

**Última revisão:** 27 de julho de 2026  
**Repositório oficial:** `brunoferreirasalustiano/lead-finder-sem-site`  
**`main` verificada:** `612a756635602ad803b2a44b50af0a04ac82622e`  
**Branch HML:** `hml/render-supabase-plan-b`  
**HEAD HML verificado:** `341ff87579d4b19a324bc77b76b569e37c222651`  
**Gate central:** issue #117  
**Estado comercial:** `REAL_MANUAL_PILOT_BLOCKED=true`  
**Mensagens:** `NOT_SENT`  
**Leads autorizados:** `0`  
**Envios comerciais:** `0`

Este documento registra o baseline operacional verificável. Quando houver divergência, prevalecem o estado live verificado, este documento na `main` atual, a issue #117 e as issues específicas, nessa ordem.

## Veredito executivo

A base de código permanece íntegra e com CI verde. As PRs #150 e #149 foram integradas, concluindo a remoção de fixtures pessoais e a conexão da console localhost auditada às rotas `OPERATOR_TEST`.

A única pull request aberta é a Draft PR #151, `security: enforce safe API PII contracts`, no HEAD `d47c9b4d2cfc8475c8df8acf1dcb24a799fbddee`. Ela permanece em draft, sem merge ou deploy.

É permitido pesquisar e qualificar até cinco empresas reais de forma privada, usando somente fontes empresariais públicas e sem publicar PII. Não é permitido contatar nenhuma empresa até o veredito explícito `REAL_MANUAL_PILOT_READY`.

Estados atuais:

- `CODEBASE_HEALTHY=true`;
- `CI_GREEN=true`;
- `PR_149_MERGED=true`;
- `PR_150_MERGED=true`;
- `PR_151_DRAFT=true`;
- `HML_API_SYNC_PENDING=true`;
- `RENDER_NEW_CODE_NOT_DEPLOYED=true`;
- `MIGRATION_0021_NOT_APPLIED=true`;
- `LEAST_PRIVILEGE_DATABASE_ROLE_PENDING=true`;
- `META_CLOUD_API_ENABLED=false`;
- `REAL_MANUAL_PILOT_BLOCKED=true`;
- `MESSAGES_NOT_SENT=true`.

## Baseline Git e PRs

- `main`: `612a756635602ad803b2a44b50af0a04ac82622e`, merge da PR #149;
- PR #150: integrada no merge commit `a27b310d12610da21244c75ccb6ec9c8367f2e7e`;
- PR #149: integrada no merge commit `612a756635602ad803b2a44b50af0a04ac82622e`;
- PR #151: aberta, draft, mergeável e não integrada;
- branch da PR #151: `agent/pii-safe-api-contracts`;
- HEAD verificado da PR #151: `d47c9b4d2cfc8475c8df8acf1dcb24a799fbddee`;
- threads de revisão abertas na PR #151: `0` antes desta atualização documental.

A comparação `hml/render-supabase-plan-b...main` está divergente: a `main` contém 35 commits ausentes na HML e a HML contém 9 commits administrativos ausentes na `main`. A sincronização deve ser feita por PR controlada, sem mover a referência por force-push.

## Evidência de CI da PR #151

No HEAD `d47c9b4d2cfc8475c8df8acf1dcb24a799fbddee`:

- CI #582, run `30289647565`: `success`;
- Deployment smoke #263, run `30289647710`: `success`;
- typecheck: aprovado;
- lint: aprovado;
- testes unitários: 4.583 aprovados e 7 ignorados;
- cobertura geral: 93,21% statements e 88,69% branches;
- cobertura PII no Node 22: 100% em statements, functions e lines;
- build: aprovado;
- audit: 0 vulnerabilidades no nível configurado;
- integração PostgreSQL: aprovada;
- restore-compose: aprovado;
- multiarch AMD64/ARM64: aprovado;
- `git diff --check`: aprovado.

A falha anterior da CI #581 foi corrigida. O checkout limpo não resolvia `@lead-finder/shared`, enquanto artefatos locais mascaravam o problema. O teste de integração também dependia de `timelineEvent.metadata`, removido do contrato HTTP seguro.

## Fronteira HTTP e PII

A PR #151 introduz projeções SQL explícitas e DTOs allowlisted para os contratos definidos em `docs/api-pii-contracts.md`.

Protegido pela PR #151:

- lista, detalhe e CSV de leads;
- contatos e histórico de qualificação;
- evidências;
- agregado CRM;
- timeline CRM;
- filas de tarefas vencidas e follow-ups;
- elegibilidade, recipients, attempts e simulations de campanhas.

Telefones, WhatsApp, e-mails, endereço, coordenadas, valores normalizados, snapshots persistidos, payloads aninhados e conteúdo renderizado não são serializados nesses contratos.

As rotas individuais de oportunidades, notas, tags e tarefas permanecem contratos operacionais autenticados por `crm:read` ou `crm:write`. Elas podem conter conteúdo criado pelo operador e não devem ser tratadas como DTOs públicos ou reutilizadas em contextos com menor privilégio. Qualquer futura redução desses contratos deve ocorrer em mudança separada e compatível com os consumidores CRM.

A PR #151 não reduz PII persistida. Histórico JSON, resultados de idempotência CRM, snapshots de campanha, outbox e dead letters continuam dependendo da frente de minimização persistente planejada.

## OPERATOR_TEST

Concluído no código:

- núcleo persistente append-only;
- rotas HTTP específicas;
- permissões `operator-test:*` separadas;
- console localhost em `127.0.0.1`;
- validação estrita das respostas da API;
- binding criptográfico de destinatário;
- telefone, mensagem e `wa.me` mantidos apenas em memória local;
- confirmação humana `SENT_CONFIRMED` ou `NOT_SENT`;
- nenhum provider, webhook ou envio automático.

Pendente no ambiente hospedado:

- sincronizar a HML;
- criar role PostgreSQL de runtime com privilégio mínimo;
- comprovar backup e rollback;
- aplicar somente a migration `0021`;
- configurar secrets privados `OPERATOR_TEST`;
- selecionar e implantar manualmente o SHA aprovado;
- validar health, SHA live, logs, grants, restart, kill switch e ausência de egress;
- executar um único teste fechado usando número pertencente ao operador.

O teste fechado não autoriza contato com lead real.

## Role PostgreSQL de privilégio mínimo

A issue #144 permanece aberta e é bloqueio real.

A role de runtime deve:

- não ser owner, superuser ou possuir `BYPASSRLS`;
- não possuir `CREATEDB`, `CREATEROLE`, `REPLICATION` ou DDL;
- receber `USAGE` somente nos schemas necessários;
- receber `SELECT` somente nas tabelas necessárias;
- receber `EXECUTE` somente nas funções allowlisted;
- não receber escrita direta nas tabelas `OPERATOR_TEST`;
- não escrever nos registros de migrations;
- usar credencial separada da credencial operacional de migrations e restore.

Antes de qualquer troca no Render, a matriz de privilégios, o SQL de criação, o rollback e os testes negativos devem passar em PostgreSQL descartável.

## Supabase e migration 0021

Projeto de homologação previamente confirmado:

- projeto: `lead-finder-brasil-homologacao`;
- project ref: `ondvzdvlwntrnieodifi`;
- região: `sa-east-1`;
- estado previamente observado: `ACTIVE_HEALTHY`.

Registros comprovados anteriormente:

- `public.schema_migrations`: `0001` a `0018`;
- `supabase_migrations.schema_migrations`: `0019` e `0020`.

Regras:

- não reaplicar `0019` ou `0020`;
- não inserir versões artificialmente;
- aplicar somente `0021`, de forma transacional e reversível;
- interromper diante de qualquer divergência;
- validar objetos, funções, triggers, constraints, RLS, grants e registros imediatamente após a aplicação.

A migration `0021` ainda não foi aplicada no Supabase hospedado.

## Render de homologação

Estado previamente confirmado:

- workspace: `Bruno's workspace`;
- serviço: `lead-finder-api-hml`;
- branch: `hml/render-supabase-plan-b`;
- auto-deploy: `off`;
- health check: `/health/ready`;
- `REAL_SEND_ENABLED=false`;
- `REAL_PROVIDERS_ENABLED=false`;
- `REAL_PROVIDER_CONFIGURED=false`;
- `COLLECTION_EGRESS_ENABLED=false`.

Não afirmar que o serviço executa a `main` ou a PR #151. O SHA live exato deve ser comprovado antes e depois de qualquer deploy controlado.

## Pesquisa privada de empresas reais

Permitido agora:

- reconstruir até cinco fichas privadas;
- confirmar nome empresarial, atividade, localização e operação;
- registrar fontes empresariais públicas;
- identificar oportunidade digital real;
- eliminar duplicidades e homônimos;
- consultar opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR` e bloqueios;
- aplicar rubrica mínima 8/10, sem dimensão em zero;
- manter cada ficha em revisão privada.

Não permitido agora:

- publicar telefone, e-mail ou outros dados de contato;
- considerar número público como opt-in para WhatsApp;
- preparar disparo automático;
- enviar mensagem comercial;
- habilitar Meta Cloud API;
- marcar lead como autorizado sem aprovação individual.

`BUSINESS_CANDIDATE` não autoriza contato.

## Sequência controlada de seis dias

1. fechar a revisão e a documentação da PR #151;
2. planejar minimização persistente, readiness e resolução estreita de contatos;
3. preparar e testar a role PostgreSQL mínima;
4. reconciliar HML, backup e rollback;
5. aplicar migration e deploy somente após todos os gates;
6. executar teste fechado do operador e emitir `GO/NO-GO`.

O prazo de seis dias é um objetivo de execução, não autorização para reduzir controles. Falha em qualquer gate implica rollback e preservação de `REAL_MANUAL_PILOT_BLOCKED`.

## Regras invariáveis

Continuam desligados:

- WhatsApp Cloud API;
- SMTP/provider de e-mail;
- webhooks;
- follow-ups automáticos;
- n8n para campanhas reais;
- automação de WhatsApp Web;
- qualquer envio comercial automático.

Nunca publicar:

- tokens, senhas ou connection strings;
- telefone ou e-mail de lead;
- mensagem integral;
- payload bruto ou snapshots com PII;
- prints com PII;
- chaves HMAC ou valores de secrets.

Toda mudança de arquitetura, ambiente, segurança, provider, piloto ou estado operacional deve atualizar este documento, a issue #117 e as issues específicas.