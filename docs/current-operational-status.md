# Estado operacional consolidado

**Última revisão documental:** 2026-07-22  
**Baseline revisada:** `38f5810d2fc959261ba3d5d858c3a4d6fa001eed`

Este documento é a fonte resumida do estado atual do Lead Finder Brasil. Ele registra o que está implementado, o que está somente preparado, quais integrações permanecem desligadas e quais bloqueios impedem o piloto real.

O histórico detalhado continua nas issues, pull requests, runbooks e evidências da CI. Quando houver divergência, o código e a CI do commit citado são a autoridade técnica; este documento deve ser atualizado na mesma PR que alterar o estado operacional.

## Estado executivo

- o núcleo de descoberta, qualificação, CRM, campanhas simuladas, outbox, limites, retry, dead-letter, piloto interno e processamento em lote está implementado;
- a aplicação continua sem envio real de e-mail ou WhatsApp;
- a coleta externa permanece desabilitada por padrão;
- a homologação usa dados sintéticos e operação fail-closed;
- o piloto manual possui runbook, template, registro de riscos e critérios de revisão humana;
- a WhatsApp Cloud API e a OpenAI ainda não estão integradas ao runtime;
- a reconciliação segura de supressões após restore foi implementada e validada na PR #69, sem autorizar restore real, retomada automática ou piloto;
- nenhum resultado comercial real foi produzido pelo sistema.

## Perfis de implantação

### `supabase-render`

Perfil de homologação e Plano B versionado no repositório:

- API Node.js no Render;
- PostgreSQL no Supabase;
- conexão server-side por `DATABASE_URL` com TLS;
- Edge Function e Cron opcionais, desabilitados até configuração explícita;
- processamento limitado, idempotente e coordenado pelo banco;
- `DRY_RUN=true` e capacidades externas desligadas.

Estado verificado em 2026-07-22:

- projeto Supabase `lead-finder-brasil-homologacao` em `ACTIVE_HEALTHY`;
- região `sa-east-1`;
- PostgreSQL 17.6;
- migrations `0001` até `0016` aplicadas;
- incidente de grants/RLS nos objetos da `0016` remediado emergencialmente na homologação, sem nova alteração do projeto durante a PR #82;
- migration corretiva `0017_restore_suppression_security_hardening.sql` em validação na PR #82 para tornar o deny-all reproduzível e proteger objetos futuros;
- nenhuma Edge Function implantada;
- somente pequeno estado sintético de homologação.

Referências:

- [Plano B Supabase + Render](infrastructure/supabase-render-plan-b.md)
- [Runbook de implantação Supabase + Render](runbooks/supabase-render-deployment.md)
- [Operação com dois perfis](runbooks/dual-deployment-operations.md)
- [Variáveis de ambiente](infrastructure/environment-variables.md)

### `oracle-vps`

Perfil self-hosted completo e ainda suportado:

- Ubuntu;
- Docker Compose;
- PostgreSQL, API e worker em rede privada;
- Caddy como entrada pública;
- n8n opcional;
- backup, restore, rollback e observabilidade locais.

A validação operacional em VPS Oracle real continua pendente. A indisponibilidade da VPS não reduz os gates de segurança e não autoriza substituir o perfil por automação não oficial.

Referência: [Runbook Oracle](ORACLE_DEPLOY.md).

## Segurança ativa

Os defaults seguros permanecem:

```text
COLLECTION_EGRESS_ENABLED=false
DRY_RUN=true
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
REAL_PROVIDER_CONFIGURED=false
```

`SHADOW_MODE_ENABLED` e `PILOT_KILL_SWITCH_ENABLED` dependem do ambiente e do estágio operacional. A configuração de homologação deve manter shadow ativo e efeitos externos desligados. O kill switch precisa ser engatado durante incidentes e comprovado antes de qualquer piloto.

A existência futura de token, chave ou provider configurado não será suficiente para liberar envio. A execução real exige simultaneamente elegibilidade, revisão humana, opt-out íntegro, idempotência, limites, janela, provider aprovado e flags explícitas.

## Supabase Data API

A Data API permanece deliberadamente deny-all:

- 39 de 39 tabelas públicas com RLS;
- zero policies;
- zero grants de tabela para `PUBLIC`, `anon` ou `authenticated`;
- zero grants de função para essas roles;
- `CREATE` no schema público revogado;
- backend conectado diretamente ao PostgreSQL;
- nenhum cliente `supabase-js` ou `/rest/v1` no runtime.

Em 2026-07-22, a aplicação da `0016` revelou que a `0015` protegia os objetos existentes, mas não os criados posteriormente pelo role efetivo das migrations. A correção emergencial de homologação restaurou o deny-all. A PR #82 versiona a correção por meio da `0017` e adiciona um gate PostgreSQL descartável; nenhum acesso adicional ao Supabase real faz parte dessa validação.

O advisor `RLS Enabled No Policy` é informativo neste desenho. Não criar policies permissivas apenas para remover o aviso.

Referência: [Segurança da Data API Supabase](supabase-data-api-security.md).

## Campanhas e processamento

Implementado em modo simulado e sem provider real:

- campanhas e versões;
- templates versionados;
- seleção elegível;
- revisão humana;
- destinatários, tentativas, eventos e outbox;
- leasing, concorrência e liderança entre processadores;
- limites diários, janela e espaçamento;
- retry limitado e dead-letter;
- recuperação auditável;
- pausa, cancelamento, opt-out e bloqueios antes da execução;
- gate sintético determinístico em PostgreSQL.

Pendente:

- adaptador oficial de e-mail;
- WhatsApp Cloud API;
- webhooks assinados e reconciliação de eventos externos;
- testes sandbox com contatos próprios autorizados;
- qualquer envio real.

## Piloto manual

A fundação documental está pronta, mas a execução continua bloqueada até todas as pré-condições passarem.

O primeiro lote deve ter no máximo cinco negócios, uma categoria e uma região, com seleção e contato individualmente revisados. Não existe autorização para scraping, importação em massa, automação de WhatsApp Web, follow-up automático ou disparo em lote.

Pré-condições principais:

1. PR #69 integrada na `main` e CI pós-merge verde no SHA exato;
2. migration `0016` aplicada e verificada na homologação antes de qualquer restore operacional;
3. homologação em dry-run e shadow mode;
4. coleta externa e providers reais desligados;
5. kill switch testado;
6. WhatsApp Business configurado fora do Git;
7. mensagem manual aprovada;
8. opt-out e `NAO_CONTATAR` revisados;
9. operador identificado e evidências sem PII pública;
10. backup, restore e rollback aplicáveis comprovados no ambiente-alvo.

Referências:

- [Pacote operacional do piloto manual](pilot-manual-operations-pack.md)
- [Template manual versionado](pilot-real-manual-message-v1.md)
- [Runbook do ciclo controlado](pilot-real-controlled-runbook.md)

## WhatsApp e IA

A arquitetura e os controles estão documentados, mas não implementados no runtime.

- IA poderá gerar rascunhos e classificações em shadow mode;
- IA nunca recebe capacidade de envio;
- falha, recusa, baixa confiança ou saída inválida resulta em revisão humana;
- prompts devem usar dados minimizados e `store=false` quando a integração OpenAI existir;
- WhatsApp real será somente pela Cloud API oficial;
- WhatsApp Web, QR Code, Baileys, Evolution API e equivalentes são proibidos;
- webhook deverá validar assinatura antes do parse e persistência;
- sandbox usará apenas allowlist de números próprios.

Referências:

- [Arquitetura de mensageria WhatsApp + IA](whatsapp-ai-messaging-architecture.md)
- [Checklist de implementação](whatsapp-ai-implementation-checklist.md)
- [Registro de riscos](whatsapp-ai-risk-register.md)
- [Issue #79 — onboarding Meta e OpenAI](https://github.com/brunoferreirasalustiano/lead-finder-sem-site/issues/79)

## Reconciliação segura após restore

A PR #69 implementa e comprova o gate `RESTORE_SUPPRESSION_SAFE`:

- exportação, validação, dry-run, aplicação, verificação e preflight em runner one-shot dentro da rede privada do Compose;
- PostgreSQL sem porta publicada;
- API e worker parados durante todo o fluxo e mantidos parados por padrão após sucesso;
- manifesto estrito, versionado, limitado, validado por SHA-256 e armazenado fora do Git;
- aplicação transacional, idempotente, monotônica e fail-closed;
- relacionamento correto `outbox -> attempt -> recipient -> lead` para `ATTEMPT_CREATED`;
- opt-out por canal restrito a EMAIL ou WHATSAPP e supressões globais aplicadas ao lead inteiro;
- alvos ausentes, contraditórios ou divergentes bloqueiam a retomada;
- evidência PostgreSQL sanitizada, sem conteúdo do manifesto, PII ou segredos;
- replay, concorrência, rollback, reinício e detecção de outbox reclamável cobertos em PostgreSQL 16;
- CI, Compose privado, deployment smoke e multiarch AMD64/ARM64 verdes no head revisado.

O veredito da branch é `RESTORE_SUPPRESSION_READY_FOR_MERGE`. O piloto continua bloqueado até integração na `main`, CI pós-merge, aplicação controlada da migration `0016` em homologação e conclusão dos demais gates operacionais.

## Site comercial e demonstrações

O catálogo público está no repositório `lead-finder-demos` e é independente do runtime de campanhas. Sua evolução, SEO, imagens e publicação são conduzidos separadamente do núcleo operacional descrito neste documento.

O botão comercial do site não significa que a aplicação principal possua provider WhatsApp. Ele apenas abre uma conversa manual no aplicativo do visitante.

## Pendências priorizadas

1. integrar a PR #69 com proteção pelo head esperado e validar CI/Deployment smoke na `main`;
2. aplicar e verificar a migration `0016` no Supabase de homologação por procedimento controlado;
3. concluir o benchmark da issue #77 sem criar índices apenas para silenciar advisor;
4. executar a fundação segura e o fluxo manual assistido da issue #71;
5. preparar OpenAI em shadow mode e Meta em sandbox pela issue #79;
6. executar o primeiro lote manual somente após todos os gates;
7. implementar propostas, dashboard e automações posteriores;
8. validar o perfil Oracle quando uma VPS adequada estiver disponível.

## Regra de manutenção documental

Toda PR que alterar arquitetura, flags, ambiente, segurança, provider, piloto ou estado de uma fase deve atualizar:

1. este documento, quando o estado consolidado mudar;
2. o `README.md`, quando a visão pública mudar;
3. o índice `docs/README.md`, quando um documento for criado ou removido;
4. o runbook específico;
5. a issue e o registro de riscos correspondentes;
6. evidências de CI, ambiente e risco residual.

Não registrar em documentação pública: tokens, senhas, connection strings, telefone de lead, e-mail de lead, mensagens integrais, payload bruto ou prints com PII.
