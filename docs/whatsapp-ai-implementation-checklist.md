# Checklist de implementação — WhatsApp + IA

## Fase A — Fundação segura

- [x] criar `packages/messaging` com contratos de provider e políticas;
- [x] criar `packages/whatsapp` com normalização E.164, link manual e provider fake;
- [x] criar `packages/ai` com provider fake e schemas de saída;
- [ ] adaptar o outbox para interface genérica sem remover o simulador atual;
- [ ] manter todos os providers externos desabilitados;
- [x] adicionar testes de opt-out, `NAO_CONTATAR`, revisão humana, idempotência e logs sanitizados.

## Fase B — Manual assistido

- [x] endpoint autenticado para gerar link manual de WhatsApp ou e-mail permitido;
- [x] exigir permissões específicas e revisão humana registrada;
- [x] registrar abertura do fluxo sem afirmar que houve envio;
- [x] registrar resultado manual separado;
- [x] impedir segundo contato após opt-out;
- [x] exigir evidência append-only `BUSINESS` aprovada para o e-mail selecionado;
- [x] separar autorização explícita de WhatsApp de fundamento empresarial de e-mail;
- [x] serializar `PREPARED -> OPENED -> CONTACT_CONFIRMED -> RESPONSE_RECORDED` por preparação;
- [x] serializar alterações de elegibilidade de e-mail e operações de mensageria pelo lock do lead, sempre antes do lock do contato;
- [x] testar replay e confirmação concorrentes contra decisão empresarial desfavorável ainda não commitada;
- [x] minimizar o snapshot e reconstruir mensagem/link somente no replay autenticado;
- [ ] permitir somente canal comercial oficial configurado fora do Git como remetente documentado.

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
- [ ] aprovação humana por lote registrada fora de evidências públicas;
- [ ] opt-out e `NAO_CONTATAR` testados end-to-end;
- [ ] nenhuma automação WhatsApp Web;
- [ ] nenhum disparo em massa;
- [ ] rollback e suspensão operacional documentados.
