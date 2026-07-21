# Brief de implementação — Fundação WhatsApp + IA

## Modelo

**Sol** — integração externa, credenciais, dados pessoais, webhooks, idempotência e risco operacional elevado.

## Objetivo desta etapa

Implementar somente a fundação segura e o envio manual assistido. Não habilitar WhatsApp Cloud API real nem OpenAI real nesta etapa.

## Base

A implementação deve partir da `main` após a integração da PR documental que registra o canal oficial e a arquitetura WhatsApp + IA.

## Escopo obrigatório

1. Criar `packages/messaging`:
   - contratos genéricos de provider;
   - estados de entrega;
   - erro tipado;
   - política de elegibilidade;
   - decisão fail-closed.

2. Criar `packages/whatsapp`:
   - normalização de telefone brasileiro para E.164;
   - validação estrita;
   - geração de link `wa.me`;
   - template manual versionado;
   - provider fake sem rede;
   - interface futura para Cloud API.

3. Criar `packages/ai`:
   - contratos de provider;
   - schemas Zod para rascunho e classificação;
   - provider fake determinístico;
   - nenhuma dependência ou chamada OpenAI nesta etapa.

4. API manual assistida:
   - endpoint autenticado para preparar contato manual;
   - permissão nova específica;
   - exige revisão humana registrada;
   - consulta `NAO_CONTATAR`, opt-out e elegibilidade;
   - retorna link manual e mensagem aprovada;
   - nunca afirma que a mensagem foi enviada;
   - endpoint separado para registrar resultado manual.

5. Persistência e auditoria:
   - reutilizar estruturas existentes quando corretas;
   - migration incremental somente se indispensável;
   - sem payload bruto, token, mensagem integral ou telefone em logs;
   - idempotência por lead, revisão e versão do template;
   - segundo contato bloqueado após opt-out.

6. Worker/outbox:
   - preservar `SimulatedOutboxAdapter` e todos os testes atuais;
   - introduzir interface genérica sem habilitar provider real;
   - não alterar `DRY_RUN=true`, `REAL_SEND_ENABLED=false`, `REAL_PROVIDERS_ENABLED=false`;
   - kill switch continua bloqueando execução.

## Fora do escopo

- token Meta;
- WhatsApp Cloud API real;
- webhook público;
- SDK de WhatsApp Web;
- Evolution API/Baileys;
- OpenAI SDK ou chave real;
- geração automática de mensagens em produção;
- envio automático;
- merge automático.

## Testes obrigatórios

- telefones válidos e inválidos;
- DDI/DDD e remoção segura de formatação;
- `NAO_CONTATAR`;
- opt-out;
- revisão humana ausente;
- template não aprovado;
- idempotência;
- replay;
- logs sanitizados;
- provider fake sem rede;
- API auth e permissionamento;
- regressão completa do outbox simulado;
- cobertura igual ou superior à base.

## Entrega

- branch nova;
- PR Ready for Review;
- sem merge;
- relatório de arquivos, decisões, testes e riscos;
- indicar claramente `WHATSAPP_AI_FOUNDATION_READY` ou bloqueio objetivo.
