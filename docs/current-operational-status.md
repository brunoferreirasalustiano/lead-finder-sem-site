# Estado operacional consolidado

**Última revisão:** 23 de julho de 2026
**Baseline integrada:** `main` em `3d5e3abd1cf9fe90a6ad0cb869c9d1ff3bfa903f`
**Gate pós-deploy:** bloqueado antes do deploy controlado

Este documento é a fonte resumida do estado atual do Lead Finder Brasil. O código, as migrations e os gates executados no SHA citado são a autoridade técnica. Issues e PRs registram o histórico e as decisões detalhadas.

A PR #118 foi integrada na baseline acima. A CI #413 foi integralmente verde no head revisado `b7ca5d3a6616057e0611140e61e1fc509c7c6571`; ainda não há execução pós-merge visível para o SHA de squash da `main`, que também não foi confirmado como implantado no Render.

## Veredito executivo

- a fundação de mensageria manual assistida está integrada na `main`;
- o Supabase possui registro dividido verificado: `0001` a `0018` em `public.schema_migrations` e `0019/0020` em `supabase_migrations.schema_migrations`;
- os objetos, triggers, RLS e ACL esperados de `0019/0020` estão presentes;
- o runner local ainda consulta somente o registro público e precisa de compatibilidade fail-closed antes de qualquer execução contra a homologação;
- a Data API permanece deny-all;
- o site e as demonstrações estão publicados no GitHub Pages;
- o aviso público de privacidade está servido e verificado;
- a API de homologação no Render está viva e pronta segundo os endpoints públicos;
- o endpoint operacional interno rejeita acesso sem autenticação;
- nenhum provider real, envio automático, webhook externo ou integração OpenAI/Meta está ativo;
- o gate de 30 barbearias terminou em `PIVOT_RECOMMENDED`;
- a categoria seguinte foi definida como manutenção e serviços técnicos;
- não há lead aprovado para contato no primeiro lote;
- o envio real continua não autorizado.

**Estado atual:** `PILOT_SEND_NOT_AUTHORIZED`.

## Registro dividido de migrations — 23 de julho de 2026

A inspeção autenticada anterior do serviço Render `srv-d9fbpp6rnols73bko9f0` registrou auto-deploy desligado, flags fail-closed e o deployment anterior `live` no SHA `49242ca6c8c0eb5f7792b99ea82f5af7db7d1c76`. A `main` e sua CI estavam verdes no SHA `0feb26885682ff19f254d70b001ccbcc39306d35`.

A inspeção autenticada atual do projeto Supabase de homologação confirmou:

- `public.schema_migrations` contém a sequência completa de `0001_initial` até `0018_service_role_least_privilege_reconciliation`;
- `supabase_migrations.schema_migrations` contém `0019_manual_assisted_messaging` com versão temporal `20260722215045`;
- `supabase_migrations.schema_migrations` contém `0020_manual_messaging_append_only_acl` com versão temporal `20260722220522`;
- os logs PostgreSQL registram a aplicação via Supabase MCP em 22 de julho de 2026;
- as tabelas `contact_channel_authorizations`, `contact_email_business_evidence`, `pilot_manual_message_preparations` e `pilot_manual_message_events` existem;
- as quatro tabelas estão vazias;
- colunas, defaults, checks, foreign keys, índices, funções e triggers correspondem materialmente ao contrato das migrations `0019` e `0020`;
- RLS está habilitada e não há policies permissivas;
- `PUBLIC`, `anon` e `authenticated` não possuem acesso efetivo;
- `service_role` possui somente `SELECT` e `INSERT` nas quatro tabelas;
- triggers append-only, transição de estado, versionamento de evidência e lock de supressão estão ativos.

A causa raiz é um **registro dividido entre dois mecanismos aprovados**, e não migration sem histórico:

- o runner do repositório registra pelo nome do arquivo em `public.schema_migrations.version`;
- o Supabase MCP registra por versão temporal e nome lógico em `supabase_migrations.schema_migrations`.

O risco operacional permanece porque `scripts/migrate.ts` consulta somente o registro público e classificaria `0019/0020` como pendentes.

Antes do deploy controlado ainda é obrigatório:

1. confirmar que o projeto Supabase inspecionado é o banco exato referenciado pelo `DATABASE_URL` efetivo do Render;
2. concluir a issue #120 com compatibilidade fail-closed para os dois registros;
3. comprovar que o runner reconhece `0019/0020` pelo nome lógico e não executa DDL;
4. validar a solução em PostgreSQL comum e Supabase;
5. confirmar CI verde no SHA exato que será implantado;
6. somente então repetir deploy, restart, kill switch e smoke test.

Até a issue #120 ser concluída:

- não executar `scripts/migrate.ts` contra a homologação;
- não reaplicar `0019` ou `0020`;
- não inserir versões manualmente em `public.schema_migrations`;
- não alterar objetos ou grants atuais.

Estados:

- `MIGRATION_REGISTRY_SPLIT_VERIFIED`;
- `MIGRATION_RUNNER_COMPATIBILITY_REQUIRED`;
- `MIGRATION_REAPPLY_BLOCKED`;
- `POST_DEPLOY_GATE_BLOCKED`.

## Evidência externa reproduzível

A PR #99 adiciona um probe somente leitura, executado pelo GitHub Actions e sem credenciais. O probe consulta exclusivamente recursos públicos e produz JSON sanitizado.

Evidência do probe verde:

### GitHub Pages

- home: HTTP 200;
- `/privacidade/`: HTTP 200;
- `/barbearia/`: HTTP 200;
- aviso de privacidade: conteúdo obrigatório verificado;
- canonical: verificado;
- navegação interna: verificada;
- indexação: habilitada;
- formulário próprio: ausente;
- Google Analytics, Tag Manager, Meta Pixel, Hotjar e Clarity: ausentes;
- nenhuma mensagem ou dado foi enviado durante o probe.

Estado: `SERVED`.

### Render

- serviço público: `lead-finder-api-hml`;
- `/health/live`: HTTP 200, `status=ok`;
- `/health/ready`: HTTP 200, `status=ready`;
- `/internal/operational-snapshot` sem token: HTTP 401;
- nenhuma rota de escrita foi chamada;
- nenhum provider, webhook ou envio foi acionado.

Estado: `OPERABLE` para disponibilidade e banco.

O probe não lê variáveis privadas do Render. A matriz efetiva de flags, o SHA implantado, logs, restart, kill switch e a correspondência exata do `DATABASE_URL` ainda precisam de evidência autenticada.

## Perfil `supabase-render`

Configuração versionada em `render.yaml`:

```text
DEPLOYMENT_PROFILE=supabase-render
DRY_RUN=true
SHADOW_MODE_ENABLED=true
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
REAL_PROVIDER_CONFIGURED=false
COLLECTION_EGRESS_ENABLED=false
PILOT_KILL_SWITCH_ENABLED=false
```

Características:

- API Node.js no Render;
- PostgreSQL no Supabase;
- conexão server-side com TLS;
- plano free e região Virginia;
- branch `hml/render-supabase-plan-b`;
- auto-deploy desligado;
- health check em `/health/ready`;
- processamento limitado e idempotente;
- secrets fora do Git.

A configuração declarada é fail-closed. A PR #99 comprova disponibilidade pública, readiness do banco e proteção do endpoint interno, mas não substitui a inspeção efetiva do ambiente Render.

## Supabase de homologação

Projeto: `lead-finder-brasil-homologacao`.

Estado consolidado:

- PostgreSQL em `ACTIVE_HEALTHY`;
- registro local de migrations de `0001` a `0018`;
- registro Supabase com `0019` e `0020` pelos nomes lógicos;
- origem da divisão de registros comprovada nos logs PostgreSQL;
- objetos esperados de `0019` e controles de ACL de `0020` presentes;
- compatibilidade do runner local pendente na issue #120;
- quatro tabelas de mensageria manual com zero registros;
- `campaign_opt_outs` e `pilot_manual_contacts` também permanecem com zero registros na consulta autenticada mais recente;
- RLS habilitada nas tabelas públicas;
- zero policies permissivas;
- zero grants para `PUBLIC`, `anon` e `authenticated`;
- `CREATE` no schema público revogado;
- backend usa conexão PostgreSQL direta;
- nenhuma Edge Function ativa para envio;
- dados reais de lead não foram inseridos durante as validações.

As tabelas append-only de mensageria permitem ao `service_role` somente `SELECT` e `INSERT`. `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER` não estão concedidos ao `service_role`. Os triggers de mutação e transição estão ativos.

Os advisors de segurança retornam somente avisos informativos de RLS sem policies, compatíveis com a postura deny-all atual. Os advisors de performance registram foreign keys sem índice e índices ainda não utilizados; esses itens precisam de benchmark antes de qualquer alteração e não justificam criar ou remover índices apenas para silenciar o advisor.

## Mensageria manual assistida

A PR #84 integrou as Fases A/B sem provider e sem rede externa de mensageria.

Implementado:

- contratos discriminados por canal;
- WhatsApp somente com opt-in explícito;
- e-mail somente com evidência `BUSINESS` e decisão humana `APPROVED`;
- templates versionados;
- normalização E.164;
- principal autenticado e permissões por ação;
- idempotência vinculada ao principal;
- replay fail-closed usando o contato persistido;
- snapshot minimizado sem telefone, e-mail, mensagem renderizada ou URL completa;
- estados `PREPARED`, `OPENED`, `CONTACT_CONFIRMED` e `RESPONSE_RECORDED`;
- transições protegidas no serviço e no PostgreSQL;
- concorrência serializada por lead e preparação;
- opt-out, `do_not_contact`, `NAO_CONTATAR` e bloqueio administrativo prioritários;
- zero outbox, attempt e provider event no fluxo manual.

Abrir um link não afirma envio. `CONTACT_CONFIRMED` depende de confirmação humana explícita.

## Concorrência de evidência empresarial

Alterações em `contact_email_business_evidence` compartilham o lock `manual-messaging:<lead_id>` usado por preparação, replay e confirmação.

Ordem fixa:

1. lock do lead;
2. lock `email-business-evidence:<contact_id>`.

Uma decisão `PERSONAL`, `UNKNOWN` ou `REJECTED` commitada antes da conclusão da operação vence e bloqueia reconstrução de link ou confirmação. A suíte PostgreSQL comprova replay, confirmação e versionamento concorrentes.

## Revogação e supressões

`contact_channel_authorizations` é histórico append-only. Revogações são representadas por `campaign_opt_outs`.

Prioridade absoluta:

1. opt-out global;
2. opt-out por canal;
3. `do_not_contact`;
4. `NAO_CONTATAR`;
5. bloqueio administrativo;
6. elegibilidade do contato;
7. autorização do canal.

Uma autorização posterior não reativa automaticamente um bloqueio. Reativação exige fluxo separado, explícito, auditado e permissionado, fora do piloto atual.

## Site comercial e demonstrações

O catálogo público está no repositório `lead-finder-demos` e é independente do runtime de campanhas.

Comprovado pelo probe externo:

- home publicada;
- demonstração de barbearia publicada;
- aviso de privacidade publicado;
- canonical e links internos válidos;
- indexação habilitada;
- contato oficial por WhatsApp e e-mail;
- nenhum formulário interno;
- nenhum tracking próprio;
- nenhum provider de envio;
- botão de WhatsApp apenas abre o aplicativo do visitante.

O site não confirma que uma mensagem foi enviada e não acessa conversas.

## Primeiro lote manual

Escopo invariável:

- até cinco negócios;
- uma categoria e uma região;
- contato individual;
- revisão humana por lead;
- WhatsApp somente com opt-in explícito;
- lead frio somente por e-mail empresarial pertinente e aprovado;
- primeiro contato sem link, imagem, PDF, proposta ou preço;
- opt-out imediato;
- nenhum follow-up automático.

### Gate de barbearias

A amostra mínima foi concluída com 30 candidatos distintos em Campinas/SP e proximidades.

Resultado:

- 30 negócios pesquisados;
- 6 excluídos por site próprio funcional;
- 22 sem site próprio confirmado ou presentes apenas em páginas de agenda/terceiros;
- 1 rejeitado por inconsistência de identidade/atividade;
- 0 canais de e-mail `BUSINESS/APPROVED`;
- 0 opt-ins válidos de WhatsApp;
- 0 leads aprovados para contato.

Decisão: `PIVOT_RECOMMENDED`.

O resultado não significa flexibilizar canal. Diretório cadastral isolado não comprova propriedade empresarial do e-mail. Telefone público ou botão de WhatsApp não é opt-in. A categoria seguinte foi definida como manutenção e serviços técnicos, mantendo os mesmos gates.

### Shortlist de manutenção e serviços técnicos

A triagem sanitizada reuniu dez códigos e foi reduzida por evidência pública agregada para quatro prioridades de validação privada:

- `LF-TM-01` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-04` — `WEAK_SITE` + `BUSINESS_CANDIDATE`;
- `LF-TM-05` — `WEAK_CONVERSION` + `BUSINESS_CANDIDATE`;
- `LF-TM-09` — `WEAK_SITE` + `BUSINESS_CANDIDATE`.

`BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`. Os quatro códigos ainda dependem de identidade, atividade, região, fonte, diagnóstico, canal, supressões, mensagem e aprovação humana individuais. Todos permanecem `NOT_SENT`.

### Métricas do primeiro lote

A documentação `first-batch-success-metrics.md` separa:

- envio confirmado pelo operador;
- resposta comercial registrada;
- qualidade da mensagem;
- qualidade operacional do projeto;
- incidentes e violações de gate.

Sem provider e sem tracking, entrega, abertura e leitura não serão alegadas. O lote de até cinco leads será analisado principalmente por contagens absolutas, auditoria integral e gates duros em zero.

## Gates concluídos

- fundação manual assistida integrada;
- registros de migrations `0019/0020` localizados no histórico Supabase;
- causa raiz do registro dividido comprovada;
- objetos, constraints, funções, triggers, RLS e ACL esperados de `0019/0020` presentes na homologação;
- ACL append-only efetiva reconciliada;
- governança do primeiro contato integrada;
- templates por canal alinhados;
- ensaio sintético e pacote de controle integrados;
- laboratório de comunicação com ranking guardado, separado por estágio, nicho e oportunidade;
- métricas de sucesso do primeiro lote documentadas;
- runbooks de prontidão integrados;
- aviso público de privacidade servido;
- Render live e ready em HTTP 200;
- snapshot interno protegido por autenticação;
- amostra de 30 barbearias concluída;
- gate de segmento emitido como `PIVOT_RECOMMENDED`;
- categoria de manutenção e serviços técnicos selecionada para qualificação privada;
- shortlist sanitizada reduzida a quatro prioridades para validação privada.

## Bloqueios restantes

### Registros e runner de migrations

- confirmar que o projeto Supabase inspecionado é o banco exato do serviço Render;
- concluir a compatibilidade fail-closed da issue #120;
- comprovar que `scripts/migrate.ts` não reaplica `0019/0020`;
- validar a origem `LOCAL`, `SUPABASE` ou `BOTH` sem escrita de histórico;
- validar a solução em PostgreSQL comum e Supabase;
- preservar backup/restore antes de qualquer futura alteração de banco.

### Homologação autenticada

- confirmar o SHA efetivamente implantado no Render;
- confirmar as variáveis efetivas sem expor valores secretos;
- revisar logs sanitizados;
- comprovar restart lógico;
- testar kill switch de forma controlada;
- comprovar ausência de egress Meta, SMTP, OpenAI e webhooks;
- confirmar workspace, service ID, branch, fonte de deploy e auto-deploy.

### Categoria e leads

- concluir fichas privadas dos quatro códigos prioritários;
- eliminar duplicidades e homônimos;
- confirmar identidade, atividade, cidade e diagnóstico de até cinco negócios;
- localizar canais publicados pelo próprio negócio;
- classificar propriedade do e-mail;
- registrar decisão humana por contato;
- consultar opt-outs e supressões;
- obter aprovação explícita de Bruno por lead.

### Execução

- personalizar mensagem sem link;
- aplicar rubrica de qualidade com mínimo `8/10` e nenhuma dimensão em zero;
- validar a demonstração escolhida;
- registrar estado inicial `NOT_SENT`;
- realizar contato exclusivamente de forma manual;
- registrar envio somente após confirmação humana;
- registrar respostas e opt-outs sem copiar conteúdo sensível.

## Integrações futuras

Continuam desligadas e fora do piloto atual:

- WhatsApp Cloud API;
- SMTP ou provider oficial de e-mail;
- OpenAI para rascunhos em shadow mode;
- webhooks assinados;
- follow-ups automáticos;
- recuperação inteligente de leads;
- n8n para campanhas reais.

WhatsApp Web, Baileys, Evolution API e sessões não oficiais permanecem proibidos.

## Perfil `oracle-vps`

O perfil self-hosted continua suportado, mas a validação em VPS Oracle real está bloqueada pela indisponibilidade de região/capacidade. Isso não bloqueia o perfil atual `supabase-render` e não reduz os gates de segurança.

## Pendências priorizadas

1. concluir a issue #120 e impedir reaplicação de `0019/0020`;
2. recuperar o conector Render e confirmar banco, workspace, serviço, branch e SHA;
3. concluir deploy controlado, restart, logs, kill switch, backup/restore, rollback e ausência de egress;
4. concluir as fichas privadas dos quatro códigos prioritários;
5. qualificar canais empresariais oficiais e consultar supressões;
6. montar até cinco fichas para aprovação individual;
7. aplicar a rubrica de qualidade e manter todas as mensagens em `NOT_SENT` até o veredito final;
8. executar qualquer contato somente após `REAL_MANUAL_PILOT_READY` e autorização individual;
9. concluir o benchmark da issue #77 sem criar índices apenas para silenciar advisor;
10. preparar Meta/OpenAI apenas em sandbox/shadow pela issue #79;
11. validar o perfil Oracle quando houver infraestrutura adequada.

## Regra de manutenção documental

Toda PR que alterar arquitetura, flags, ambiente, segurança, provider, piloto ou estado de uma fase deve atualizar:

1. este documento;
2. o `README.md`, quando a visão pública mudar;
3. `docs/README.md`, quando documentos forem criados ou removidos;
4. o runbook específico;
5. a issue e o registro de riscos correspondentes;
6. as evidências de CI e ambiente.

Não registrar em documentação pública: tokens, senhas, connection strings, telefone de lead, e-mail de lead, mensagens integrais, payload bruto ou prints com PII.
