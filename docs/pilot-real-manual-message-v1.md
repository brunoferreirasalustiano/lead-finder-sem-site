# Mensagens comerciais manuais — piloto real controlado v1

**Estado:** templates aprovados para preparação manual controlada; nenhum envio automático autorizado.

## Regra de escolha do canal

- **WhatsApp:** somente quando existir autorização explícita atual e compatível, registrada como `DIRECT_OPT_IN`, `FORM_OPT_IN` ou `SIGNED_RECORD`.
- **E-mail:** somente quando o endereço estiver válido, verificado, classificado como `BUSINESS`, com decisão humana atual `APPROVED` e origem pertinente.
- **Sem canal elegível:** não contatar.

Um telefone apenas publicado na internet não é opt-in de WhatsApp. Um domínio gratuito de e-mail não é automaticamente pessoal nem empresarial; a evidência e a revisão humana são obrigatórias.

## WhatsApp — primeiro contato após opt-in

> Olá! Aqui é o Bruno F. Salustiano, da Lead Finder Brasil. Você autorizou nosso contato por WhatsApp sobre soluções digitais para a [EMPRESA]. Preparei uma ideia relacionada ao segmento de vocês. Posso enviar a demonstração para avaliação, sem compromisso? Caso não queira continuar, é só me avisar que encerro o contato e registro o bloqueio.

Regras específicas:

- mencionar a autorização compatível;
- não anexar imagem, PDF ou proposta no primeiro contato;
- não incluir link ou preço antes da permissão;
- não afirmar que a demonstração foi solicitada quando isso não ocorreu;
- aplicar opt-out imediatamente.

## E-mail empresarial — primeiro contato

**Assunto:** `Ideia de presença digital para [EMPRESA]`

> Olá, tudo bem? Meu nome é Bruno F. Salustiano, fundador da Lead Finder Brasil. Encontrei o contato comercial da [EMPRESA] em [FONTE] e estou entrando em contato individualmente porque trabalho com criação de páginas e soluções digitais para negócios locais. Preparei uma ideia de demonstração relacionada ao segmento de vocês. Posso enviar para uma avaliação, sem compromisso? Caso prefira não receber novos contatos, basta responder a este e-mail informando isso e farei o bloqueio imediato.

Regras específicas:

- `[FONTE]` deve descrever a origem de forma verdadeira e compreensível;
- usar somente endereço empresarial `BUSINESS / APPROVED`;
- não usar endereço pessoal ou de propriedade `UNKNOWN`;
- não adicionar tracking, pixel ou anexo inesperado;
- não incluir link, imagem, PDF, proposta ou preço no primeiro contato;
- não criar follow-up automático;
- aplicar opt-out imediatamente.

## Regras comuns

- manter a identificação do remetente e da Lead Finder Brasil;
- explicar o motivo sem alegar fato não confirmado;
- não usar urgência, pressão, promessa ou garantia enganosa;
- permitir resposta negativa simples;
- registrar e respeitar opt-out, bloqueio, `do_not_contact` e `NAO_CONTATAR`;
- preparar e revisar individualmente cada mensagem;
- registrar `OPENED` sem afirmar envio;
- registrar `CONTACT_CONFIRMED` somente após confirmação humana;
- este arquivo nunca é uma ordem de envio.

## Checklist de aprovação por lead

| Campo | Preenchimento obrigatório antes de qualquer contato manual |
|---|---|
| Segmento | `[PREENCHER]` |
| Região | `[PREENCHER]` |
| Canal selecionado | `WHATSAPP` ou `EMAIL` |
| Evidência de elegibilidade do canal | `[PREENCHER / REGISTRAR FORA DO REPOSITÓRIO]` |
| Responsável pela aprovação | `[CONFIGURADO FORA DO REPOSITÓRIO]` |
| Template | `pilot-whatsapp-first-contact` ou `pilot-email-first-contact` |
| Versão | `v1` |
| Data/hora UTC de aprovação | `[PREENCHER]` |
| Texto final aprovado | `[REGISTRAR EM ARMAZENAMENTO PRIVADO]` |
| Critérios de suspensão | `opt-out, NAO_CONTATAR, bloqueio, contato inválido, incidente ou dúvida sobre elegibilidade` |
| Revisão humana individual | `[CONFIRMAR]` |
| Nenhum envio automático | `[CONFIRMAR]` |
| Nenhum link/preço/anexo sem autorização | `[CONFIRMAR]` |

Não armazene nome de pessoa física desnecessário, token, telefone, e-mail, payload ou mensagem efetivamente enviada na evidência técnica pública. Use identificador técnico do operador, identificador técnico do lead e os registros auditáveis protegidos pela aplicação.
