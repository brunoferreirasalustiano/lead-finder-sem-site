# Estado operacional consolidado

**Última revisão:** 23 de julho de 2026
**Baseline integrada:** `main` em `0feb26885682ff19f254d70b001ccbcc39306d35`
**Gate pós-deploy:** bloqueado antes do deploy

Este documento é a fonte resumida do estado atual do Lead Finder Brasil. O código, as migrations e os gates executados no SHA citado são a autoridade técnica. Issues e PRs registram o histórico e as decisões detalhadas.

## Veredito executivo

- a fundação de mensageria manual assistida está integrada na `main`;
- a homologação Supabase está provisionada, mas a inspeção autenticada mais recente reconheceu somente as migrations `0001` até `0018`;
- a Data API permanece deny-all;
- o site e as demonstrações estão publicados no GitHub Pages;
- o aviso público de privacidade está servido e verificado;
- a API de homologação no Render está viva e pronta segundo os endpoints públicos;
- o endpoint operacional interno rejeita acesso sem autenticação;
- nenhum provider real, envio automático, webhook externo ou integração OpenAI/Meta está ativo;
- o gate de 30 barbearias terminou em `PIVOT_RECOMMENDED`;
- não há lead aprovado para contato no primeiro lote;
- o envio real continua não autorizado.

**Estado atual:** `PILOT_SEND_NOT_AUTHORIZED`.

## Bloqueio pré-deploy de 23 de julho de 2026

A inspeção autenticada do serviço Render `srv-d9fbpp6rnols73bko9f0` confirmou
auto-deploy desligado, flags fail-closed e o deployment anterior `live` no SHA
`49242ca6c8c0eb5f7792b99ea82f5af7db7d1c76`. A `main` e sua CI estão verdes
no SHA `0feb26885682ff19f254d70b001ccbcc39306d35`.

O banco efetivamente referenciado pelo serviço respondeu por TLS, porém sua
`schema_migrations` reconheceu somente `0016` a `0018`. As migrations `0019` e
`0020` não estavam registradas, e as tabelas introduzidas por `0019` não
existiam. O comando do serviço inicia diretamente a API e não executa
migrations.

Por isso, nenhum deploy, restart, alteração de flag, teste de kill switch ou
restore foi executado. O gate permanece `POST_DEPLOY_GATE_BLOCKED` até que uma
etapa separada e explicitamente autorizada aplique e valide `0019` e `0020` no
banco de homologação antes de repetir o deploy controlado.

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

O probe não lê variáveis privadas do Render. A matriz efetiva de flags, o SHA implantado, logs, restart e kill switch ainda precisam de evidência autenticada ou do conector Render.

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
- migrations `0001` a `0018` reconhecidas na inspeção autenticada mais recente;
- migrations `0019` e `0020` pendentes no banco efetivamente usado pelo Render;
- RLS habilitada nas tabelas públicas;
- zero policies permissivas;
- zero grants para `PUBLIC`, `anon` e `authenticated`;
- `CREATE` no schema público revogado;
- backend usa conexão PostgreSQL direta;
- nenhuma Edge Function ativa para envio;
- dados reais de lead não foram inseridos durante as validações.

As tabelas append-only de mensageria permitem ao `service_role` somente `SELECT` e `INSERT`. `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` e `TRIGGER` foram revogados pela migration `0020` e possuem gate de regressão PostgreSQL.

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

O resultado não significa flexibilizar canal. Diretório cadastral isolado não comprova propriedade empresarial do e-mail. Telefone público ou botão de WhatsApp não é opt-in. A próxima etapa é comparar categorias alternativas sem contato e escolher uma com canais empresariais oficiais mais verificáveis.

## Gates concluídos

- fundação manual assistida integrada;
- migrations `0019` e `0020` aplicadas em homologação;
- ACL append-only reconciliada;
- governança do primeiro contato integrada;
- templates por canal alinhados;
- ensaio sintético e pacote de controle integrados;
- runbooks de prontidão integrados;
- aviso público de privacidade servido;
- Render live e ready em HTTP 200;
- snapshot interno protegido por autenticação;
- amostra de 30 barbearias concluída;
- gate de segmento emitido como `PIVOT_RECOMMENDED`.

## Bloqueios restantes

### Homologação autenticada

- confirmar o SHA efetivamente implantado no Render;
- confirmar as variáveis efetivas sem expor valores secretos;
- revisar logs sanitizados;
- comprovar restart lógico;
- testar kill switch de forma controlada;
- comprovar ausência de egress Meta, SMTP, OpenAI e webhooks;
- registrar service ID e workspace quando o conector Render voltar a funcionar.

### Categoria e leads

- comparar categorias alternativas;
- escolher a categoria do lote após o gate de pivot;
- localizar canais publicados pelo próprio negócio;
- classificar propriedade do e-mail;
- registrar decisão humana por contato;
- consultar opt-outs e supressões;
- reduzir para no máximo cinco fichas completas;
- obter aprovação explícita de Bruno por lead.

### Execução

- personalizar mensagem sem link;
- validar a demonstração escolhida;
- registrar estado inicial `NOT_SENT`;
- realizar contato exclusivamente de forma manual;
- registrar envio somente após confirmação humana.

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

1. integrar e manter o probe externo da PR #99;
2. recuperar o conector Render e concluir a inspeção autenticada;
3. testar restart, logs, kill switch e ausência de egress;
4. concluir a comparação de categorias alternativas;
5. selecionar uma nova categoria para o lote;
6. qualificar canais empresariais oficiais;
7. montar até cinco fichas para aprovação;
8. executar qualquer contato somente após autorização individual;
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
