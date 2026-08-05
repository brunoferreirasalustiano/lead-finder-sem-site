# E-mail comercial manual — piloto real controlado v2

**Estado:** contrato aprovado para preparação e revisão; envio real continua bloqueado pelos gates operacionais.

Este documento substitui somente a seção de e-mail do arquivo `pilot-real-manual-message-v1.md`. O template `v1` permanece imutável para compatibilidade histórica e fingerprints. O canal WhatsApp não é alterado por este documento.

## Template versionado

- ID: `pilot-email-first-contact`;
- versão: `v2`;
- canal: `EMAIL`;
- uso: primeiro contato individual com e-mail empresarial público `BUSINESS / APPROVED`;
- demonstrações: `https://brunoferreirasalustiano.github.io/lead-finder-demos/`.

### Assunto

`Posso preparar uma ideia de site para a [EMPRESA]?`

### Corpo

> Olá, tudo bem? Meu nome é Bruno F. Salustiano, fundador da Lead Finder Brasil. Encontrei o e-mail comercial da [EMPRESA] em [FONTE]. Ao revisar a presença digital do negócio, não localizei um site oficial próprio. Posso preparar uma demonstração de site sem compromisso? Estes são exemplos de sites e demonstrações da Lead Finder Brasil: https://brunoferreirasalustiano.github.io/lead-finder-demos/ Caso prefira não receber novos contatos, basta responder a este e-mail e farei o bloqueio imediato.

## Pré-condições por destinatário

- negócio aparentemente ativo, identidade e região confirmadas;
- ausência de site oficial próprio confirmada individualmente imediatamente antes da aprovação;
- e-mail sintaticamente válido, verificado e associado ao negócio;
- evidência atual `BUSINESS / APPROVED` com fonte pertinente;
- contato exato selecionado, sem fallback automático;
- nenhuma duplicidade ou contato anterior incompatível;
- nenhum bounce, complaint, opt-out global ou por canal;
- `is_blocked=false`, `do_not_contact=false` e CRM diferente de `NAO_CONTATAR`;
- revisão humana individual e decisão `APROVADO_NOT_SENT`;
- issue #117 em `REAL_MANUAL_PILOT_READY` antes de qualquer envio.

Qualquer dúvida resulta em rejeição ou revisão humana, nunca em contato.

## Regras de execução

- exatamente um destinatário por ação;
- remetente operacional da Lead Finder Brasil;
- sem CC e sem BCC;
- sem anexo, pixel, tracking ou parâmetro de rastreamento;
- sem WhatsApp no mesmo primeiro contato;
- sem follow-up automático;
- sem retry depois de falha, timeout ou resultado ambíguo;
- falha ambígua interrompe o restante do lote;
- preparação, abertura, entrega e confirmação humana são estados distintos;
- opt-out recebido deve ser aplicado imediatamente e prevalecer sobre qualquer campanha.

## Estado técnico atual

O repositório mantém `EMAIL_CONSUMER_UNAVAILABLE` para novas preparações enquanto o consumidor local/restrito do Gmail não estiver integrado e validado. A existência deste template não habilita Gmail, provider, envio ou coleta.

Uma etapa separada deve comprovar:

1. preparação do template `v2` sem expor destinatário ou conteúdo em logs;
2. consumidor Gmail restrito à conta operacional;
3. reserva idempotente antes da chamada externa;
4. ausência de CC, BCC e anexos na chamada;
5. falha ambígua registrada sem retry;
6. interrupção do lote em timeout ou resultado incerto;
7. registro sanitizado do resultado;
8. kill switch e rollback.

## Critério de aprovação

A mensagem deve obter no mínimo `8/10`, sem dimensão em zero, considerando:

- evidência e relevância;
- clareza;
- personalização;
- conformidade e opt-out;
- brevidade e chamada para ação.

Este arquivo nunca é uma ordem de envio e não autoriza contato real por si só.
