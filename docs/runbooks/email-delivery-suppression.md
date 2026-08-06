# Reconciliação de supressão de e-mail

Este runbook descreve um fluxo manual e auditável para registrar hard bounces,
contatos inválidos, opt-outs e reclamações. Ele não autoriza novos envios,
follow-up, retry, alteração de provider ou promoção para produção.

## Invariantes

- a migration `0041_email_delivery_suppression` deve estar aplicada e validada;
- o evento deve corresponder a exatamente um contato `EMAIL` já persistido;
- o endereço é recebido somente por `stdin` e não é incluído no resultado;
- a tabela de supressão armazena apenas `contact_id`, `lead_id`, metadados
  sanitizados e uma fingerprint HMAC;
- `HARD_BOUNCE` e `INVALID_CONTACT` definem `lead_contacts.is_valid=false`;
- `OPT_OUT` e `COMPLAINT` criam a supressão de canal `EMAIL` já utilizada pelos
  gates de elegibilidade;
- replay idêntico é idempotente;
- fingerprint reutilizada com conteúdo divergente falha fechada;
- não há retry após timeout ou resultado ambíguo sem verificar o banco.

## Configuração local

Forneça em memória:

- `DATABASE_URL` de uma identidade autorizada;
- `EMAIL_SUPPRESSION_FINGERPRINT_KEY` aleatória, com no mínimo 32 caracteres.

Não coloque essas variáveis, o endereço, o JSON do evento ou o comando completo
em issues, pull requests, logs compartilhados ou histórico de shell.

## Entrada

Execute `npm run operator:email:suppression` e forneça um único objeto JSON por
`stdin` com:

- `recipient`: endereço empresarial que recebeu o evento;
- `reason`: `HARD_BOUNCE`, `INVALID_CONTACT`, `OPT_OUT` ou `COMPLAINT`;
- `source`: código sanitizado, como `GMAIL_DSN` ou `OPERATOR_CONFIRMED`;
- `eventId`: identificador estável do evento no sistema de origem;
- `occurredAt`: timestamp ISO 8601 com offset.

O resultado não contém endereço, IDs internos nem secrets. Códigos possíveis de
bloqueio incluem `CONTACT_NOT_FOUND`, `CONTACT_MATCH_AMBIGUOUS` e
`EMAIL_SUPPRESSION_RECONCILIATION_FAILED`.

## Sequência operacional

1. confirme que o evento é definitivo;
2. confirme que não é apenas atraso temporário;
3. execute uma vez com uma fingerprint key mantida somente em memória;
4. registre apenas o resultado sanitizado;
5. verifique que o contato deixou de ser elegível;
6. mantenha novos envios bloqueados enquanto a taxa de bounce do lote estiver
   acima do limite interno aprovado.

## Proibições

- não sondar SMTP para descobrir se caixas existem;
- não reenviar para hard bounce;
- não registrar endereço na tabela de supressão;
- não usar a rotina para criar novos contatos;
- não transformar falha ambígua em sucesso;
- não habilitar envio comercial automaticamente.
