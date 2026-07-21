# Arquitetura de mensageria WhatsApp + IA

**Estado:** proposta de implementação; nenhum provider real, envio, webhook ou IA está habilitado por este documento.

## Objetivo

Adicionar ao Lead Finder Brasil uma camada segura para:

1. gerar e revisar mensagens comerciais com apoio de IA;
2. iniciar contatos manuais assistidos durante o piloto;
3. integrar posteriormente a WhatsApp Business Cloud API oficial;
4. receber respostas e estados de entrega por webhook;
5. preservar opt-out, `NAO_CONTATAR`, auditoria, idempotência e kill switch.

## Princípios obrigatórios

- WhatsApp Web, bibliotecas de sessão não oficial e disparo em massa são proibidos.
- Nenhuma mensagem pode ser enviada sem elegibilidade, revisão humana e autorização de execução.
- IA gera rascunho e classificação; IA não autoriza contato e não ignora `NAO_CONTATAR`.
- `DRY_RUN=true`, `REAL_SEND_ENABLED=false`, `REAL_PROVIDERS_ENABLED=false` e `PILOT_KILL_SWITCH_ENABLED=true` permanecem como padrão seguro antes da inicialização operacional controlada.
- Credenciais nunca entram no Git, logs, evidências ou payloads de erro.
- Webhooks devem validar assinatura antes de interpretar ou persistir eventos.
- Eventos externos devem ser idempotentes e reconciliáveis.

## Estrutura proposta

```text
packages/
  messaging/
    src/
      contracts.ts
      message-policy.ts
      delivery-result.ts
      index.ts
  whatsapp/
    src/
      phone.ts
      templates.ts
      manual-link.ts
      provider.ts
      cloud-api-client.ts
      webhook-signature.ts
      webhook-events.ts
      index.ts
  ai/
    src/
      provider.ts
      lead-brief.ts
      message-draft.ts
      reply-classification.ts
      schemas.ts
      index.ts

apps/api/src/
  whatsapp-webhook.ts
  whatsapp-routes.ts
  ai-routes.ts

apps/worker/src/
  messaging-outbox-adapter.ts
```

## Fase 1 — piloto manual assistido

- normalizar telefone em E.164;
- verificar `NAO_CONTATAR`, opt-out, contato válido e revisão humana;
- montar mensagem aprovada sem envio automático;
- gerar link `wa.me` para clique humano;
- registrar somente intenção, revisão e resultado manual;
- IA opcional para gerar rascunho estruturado;
- nenhum token Meta necessário;
- nenhum provider real habilitado.

## Fase 2 — IA em shadow mode

Casos de uso permitidos:

- resumir informações públicas já aprovadas do lead;
- gerar rascunho curto e versão alternativa;
- detectar alegações não suportadas;
- classificar resposta em `INTERESSADO`, `PEDIU_INFORMACOES`, `NAO_INTERESSADO`, `OPT_OUT`, `CONTATO_INVALIDO` ou `REVISAO_HUMANA`;
- sugerir próximo passo, sempre sem enviar.

Requisitos:

- saída estruturada validada por schema;
- minimização de dados pessoais no prompt;
- nenhuma decisão de envio baseada somente em IA;
- falha da IA resulta em `REVISAO_HUMANA`;
- armazenar apenas dados necessários e sanitizados;
- limite de custo, timeout e circuit breaker.

## Fase 3 — WhatsApp Cloud API em sandbox

- cliente HTTP oficial via Graph API;
- envio somente para números de teste/allowlist;
- suporte inicial a template aprovado;
- chave de idempotência por execução;
- confirmação de aceitação do provider separada de entrega;
- webhook GET para verificação e POST com validação de assinatura;
- estados `accepted`, `sent`, `delivered`, `read` e `failed` reconciliados;
- payload bruto não persistido;
- retry somente para falhas transitórias classificadas;
- bloqueio imediato por opt-out ou kill switch.

## Fase 4 — piloto real controlado

Só pode ser habilitada após:

- Meta Business e WABA configurados;
- número aprovado na Cloud API;
- template aprovado;
- webhook HTTPS validado;
- testes sandbox e integração verdes;
- `NAO_CONTATAR` e opt-out comprovados;
- kill switch comprovado;
- limites diários e janela de contato aprovados;
- aprovação humana final documentada.

## Variáveis previstas

```text
WHATSAPP_PROVIDER=disabled
WHATSAPP_GRAPH_API_VERSION=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR

AI_PROVIDER=disabled
OPENAI_API_KEY=
OPENAI_MODEL=
AI_REQUEST_TIMEOUT_MS=15000
AI_DAILY_BUDGET_CENTS=0
```

Os arquivos `.env.example` devem conter somente nomes e placeholders seguros. Segredos reais devem ficar no gerenciador de segredos do ambiente.

## Gates de implementação

- typecheck, lint, testes unitários e cobertura;
- testes de normalização de telefone;
- testes de bloqueio por `NAO_CONTATAR` e opt-out;
- testes de revisão humana obrigatória;
- testes de assinatura de webhook com payload original;
- testes de idempotência e replay;
- testes de timeout, 429 e falhas 5xx;
- testes de minimização e sanitização de logs;
- testes com provider fake; nenhuma chamada externa na CI padrão;
- sandbox real executado separadamente e com evidência sanitizada.

## Critério de segurança

A existência de credenciais ou do provider configurado não habilita envio. A execução real exige simultaneamente provider configurado, flags explícitas, kill switch liberado, política de campanha aprovada, contato elegível e revisão humana válida.