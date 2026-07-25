# Sandbox oficial — Meta WhatsApp Cloud API

## Objetivo

Preparar um teste isolado da WhatsApp Cloud API usando apenas o número de teste fornecido pela Meta e um número pessoal autorizado do operador.

Este runbook não habilita envio para leads, não altera os gates do runtime e não autoriza uso do número comercial em produção.

## Estado inicial obrigatório

Manter:

```text
WHATSAPP_PROVIDER=disabled
REAL_SEND_ENABLED=false
REAL_PROVIDERS_ENABLED=false
REAL_PROVIDER_CONFIGURED=false
DRY_RUN=true
SHADOW_MODE_ENABLED=true
```

A existência de conta, token ou IDs não altera essas flags.

## Parte administrativa na Meta

A execução desta parte exige ação humana no painel da Meta:

1. acessar ou criar o Meta Business Portfolio correto;
2. criar um Meta App dedicado ao Lead Finder Brasil;
3. adicionar o produto WhatsApp;
4. concluir o fluxo inicial da Cloud API;
5. identificar a WABA de teste e o número de teste fornecido pela Meta;
6. adicionar exclusivamente o número pessoal autorizado como destinatário de teste;
7. enviar o template de teste disponibilizado pelo ambiente;
8. confirmar o recebimento no número pessoal;
9. não cadastrar leads reais como destinatários de teste.

Referências oficiais:

- documentação da WhatsApp Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api/overview`;
- coleção oficial da Meta no Postman: `https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api`;
- preços da plataforma: `https://whatsappbusiness.com/products/platform-pricing/`.

## Segredos e identificadores

Guardar somente em gerenciador de segredos, nunca no Git:

```text
WHATSAPP_GRAPH_API_VERSION
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_APP_SECRET
WHATSAPP_WEBHOOK_VERIFY_TOKEN
```

Durante o primeiro teste, o token temporário do painel pode ser usado apenas na sessão controlada. Ele não deve ser copiado para documentação, issue, PR, log, artifact ou mensagem de chat.

## Evidência sanitizada do primeiro teste

Registrar somente:

- timestamp UTC;
- identificador técnico do ambiente;
- últimos quatro dígitos do destinatário;
- nome e idioma do template de teste;
- status HTTP;
- ID da mensagem parcialmente mascarado ou fingerprint;
- estado observado: aceito, enviado, entregue, lido ou falhou;
- confirmação de que o destinatário pertence ao operador;
- confirmação de que nenhum lead foi envolvido.

Não registrar:

- token;
- App Secret;
- verify token;
- telefone completo;
- payload integral;
- conteúdo de conversa;
- screenshot com PII.

## Gate antes da integração no código

Não adicionar cliente Graph API ao runtime até comprovar:

- conta e ativos corretos;
- teste manual do painel recebido;
- allowlist limitada ao operador;
- procedimento de revogação do token;
- orçamento e acompanhamento de custos;
- webhook HTTPS planejado;
- validação `x-hub-signature-256` sobre bytes originais;
- deduplicação e idempotência;
- logs sem PII;
- kill switch testado;
- revisão de templates e categorias;
- ausência de qualquer necessidade de WhatsApp Web automatizado.

## Próxima implementação

A integração real deve ocorrer em PR separada e usar **modelo Sol**, porque envolve:

- credenciais externas;
- chamadas de rede;
- webhook público;
- assinatura criptográfica;
- reconciliação de estados;
- idempotência;
- risco financeiro e reputacional.

A PR da console manual permanece **Terra** e não deve incorporar nenhuma dessas responsabilidades.
