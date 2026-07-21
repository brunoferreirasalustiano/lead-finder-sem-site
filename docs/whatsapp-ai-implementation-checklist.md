# Checklist de implementação — WhatsApp + IA

## Fase A — Fundação segura

- [ ] criar `packages/messaging` com contratos de provider e políticas;
- [ ] criar `packages/whatsapp` com normalização E.164, link manual e provider fake;
- [ ] criar `packages/ai` com provider fake e schemas de saída;
- [ ] adaptar o outbox para interface genérica sem remover o simulador atual;
- [ ] manter todos os providers externos desabilitados;
- [ ] adicionar testes de opt-out, `NAO_CONTATAR`, revisão humana, idempotência e logs sanitizados.

## Fase B — Manual assistido

- [ ] endpoint autenticado para gerar link manual de WhatsApp;
- [ ] exigir permissão específica e revisão humana registrada;
- [ ] registrar abertura do fluxo sem afirmar que houve envio;
- [ ] registrar resultado manual separado;
- [ ] impedir segundo contato após opt-out;
- [ ] permitir somente número comercial oficial como remetente documentado.

## Fase C — IA em shadow mode

- [ ] integração OpenAI atrás de `AI_PROVIDER=disabled|openai`;
- [ ] Responses API com saída estruturada;
- [ ] rascunho de mensagem sem envio;
- [ ] classificação de respostas sem ação automática;
- [ ] fallback obrigatório para revisão humana;
- [ ] timeout, limite diário de custo e circuit breaker;
- [ ] prompts sem payload bruto e com minimização de PII;
- [ ] moderação quando aplicável;
- [ ] `store=false` e política de retenção documentada.

## Fase D — WhatsApp Cloud API sandbox

- [ ] configuração Meta Business/WABA;
- [ ] token e IDs somente em secrets;
- [ ] cliente Graph API com timeout e erros tipados;
- [ ] templates aprovados e versionados;
- [ ] webhook GET de verificação;
- [ ] webhook POST com assinatura validada sobre bytes originais;
- [ ] reconciliação de estados de entrega;
- [ ] allowlist de números de teste;
- [ ] nenhum envio livre fora das regras da plataforma;
- [ ] evidência sandbox sanitizada.

## Fase E — Gate de piloto real

- [ ] `REAL_PROVIDER_CONFIGURED=true` somente após sandbox aprovado;
- [ ] kill switch testado;
- [ ] limites e janela revisados;
- [ ] aprovação humana por lote;
- [ ] opt-out e `NAO_CONTATAR` testados end-to-end;
- [ ] nenhuma automação WhatsApp Web;
- [ ] nenhum disparo em massa;
- [ ] rollback e suspensão operacional documentados.