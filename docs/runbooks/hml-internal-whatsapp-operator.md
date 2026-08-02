# Operador HML para confirmação manual do WhatsApp

Este operador é uma identidade temporária e exclusiva de homologação para um único teste interno com número controlado pelo operador.

## Guardas

- `DEPLOYMENT_ENVIRONMENT` precisa ser exatamente `homologation`.
- `HML_OPERATOR_AUTH_ENABLED`, hash, expiração e principal são obrigatórios juntos.
- A credencial é armazenada somente como hash, expira em até 30 minutos e deve ser revogada imediatamente após o teste.
- O principal `HML_SMOKE_BEARER_TOKEN` continua proibido de registrar `SENT_CONFIRMED`.
- O operador HML recebe somente `manual-messaging:prepare`, `manual-messaging:open`, `manual-messaging:cancel` e `manual-messaging:confirm`.
- Não há envio automático, acesso a campanhas, coleta, administração, segredos ou produção.

## Operação

1. Ativar a configuração somente no serviço HML e realizar deploy controlado.
2. Gerar o token localmente em memória; configurar somente o hash e a expiração.
3. Criar uma preparação nova com dados sintéticos e o número controlado do operador.
4. Abrir o link `wa.me` com redirecionamento manual, sem imprimir `Location`.
5. Conferir destinatário e texto. O operador pressiona **Enviar** manualmente.
6. Somente após confirmação humana explícita, registrar `SENT_CONFIRMED` uma única vez.
7. Confirmar auditoria, recebimento e ausência de duplicidade.
8. Desativar a credencial, remover hash/expiração/principal e confirmar `401`.

Nunca reutilize uma preparação, token ou número público. Em caso de dúvida, registre `NOT_SENT` ou cancele e encerre o teste.
