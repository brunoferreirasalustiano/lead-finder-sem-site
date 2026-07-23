# Mensagens comerciais manuais — piloto real controlado v1

**Estado:** templates aprovados para preparação manual controlada; nenhum envio automático autorizado.

Estes templates somente podem ser usados depois que a ficha individual estiver completa, a mensagem atingir pelo menos `8/10` sem dimensão em zero, Bruno F. Salustiano registrar `APROVADO_NOT_SENT` e a issue #117 emitir `REAL_MANUAL_PILOT_READY`.

## Regra de escolha do canal

- **WhatsApp:** somente quando existir autorização explícita atual e compatível, registrada como `DIRECT_OPT_IN`, `FORM_OPT_IN` ou `SIGNED_RECORD`.
- **E-mail:** somente quando o endereço estiver válido, verificado, classificado como `BUSINESS`, com decisão humana atual `APPROVED` e origem pertinente.
- **Sem canal elegível:** não contatar.

Um telefone apenas publicado na internet não é opt-in de WhatsApp. Um domínio gratuito de e-mail não é automaticamente pessoal nem empresarial; a evidência e a revisão humana são obrigatórias. `BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`.

## WhatsApp — primeiro contato após opt-in

> Olá! Aqui é o Bruno F. Salustiano, da Lead Finder Brasil. Você autorizou nosso contato por WhatsApp sobre soluções digitais para a [EMPRESA]. Preparei uma ideia relacionada ao segmento de vocês. Posso enviar a demonstração para avaliação, sem compromisso? Caso não queira continuar, é só me avisar que encerro o contato e registro o bloqueio.

Regras específicas:

- mencionar a autorização compatível;
- não anexar imagem, PDF ou proposta no primeiro contato;
- não incluir link ou preço antes da permissão;
- não afirmar que a demonstração foi solicitada quando isso não ocorreu;
- não usar o template se a autorização estiver ausente, expirada, ambígua ou incompatível;
- aplicar opt-out imediatamente.

## E-mail empresarial — primeiro contato

**Assunto:** `Ideia de presença digital para [EMPRESA]`

> Olá, tudo bem? Meu nome é Bruno F. Salustiano, fundador da Lead Finder Brasil. Encontrei o contato comercial da [EMPRESA] em [FONTE] e estou entrando em contato individualmente porque trabalho com criação de páginas e soluções digitais para negócios locais. Preparei uma ideia de demonstração relacionada ao segmento de vocês. Posso enviar para uma avaliação, sem compromisso? Caso prefira não receber novos contatos, basta responder a este e-mail informando isso e farei o bloqueio imediato.

Regras específicas:

- `[FONTE]` deve descrever a origem de forma verdadeira e compreensível;
- usar somente endereço empresarial `BUSINESS / APPROVED`;
- não usar endereço pessoal, `UNKNOWN` ou apenas `BUSINESS_CANDIDATE`;
- não adicionar tracking, pixel ou anexo inesperado;
- não incluir link, imagem, PDF, proposta ou preço no primeiro contato;
- não criar follow-up automático;
- aplicar opt-out imediatamente.

## Uso de diagnóstico ou oportunidade

O primeiro contato não precisa citar o diagnóstico. Quando houver personalização baseada em `NO_SITE`, `THIRD_PARTY_ONLY`, `WEAK_SITE`, `BROKEN_SITE` ou `WEAK_CONVERSION`:

- usar somente evidência individual aprovada;
- descrever o fato de forma neutra e específica;
- não presumir perda de clientes, baixa conversão, faturamento ou impacto financeiro;
- não usar ranking sintético como evidência real;
- remover a alegação quando houver dúvida.

## Regras comuns

- manter a identificação do remetente e da Lead Finder Brasil;
- explicar o motivo sem alegar fato não confirmado;
- não usar urgência, pressão, promessa ou garantia enganosa;
- permitir resposta negativa simples;
- registrar e respeitar opt-out, bloqueio, `do_not_contact` e `NAO_CONTATAR`;
- preparar e revisar individualmente cada mensagem;
- registrar `OPENED` sem afirmar envio;
- registrar `CONTACT_CONFIRMED` ou `SENT_CONFIRMED` somente após confirmação humana correspondente;
- manter `NOT_SENT` quando o contato for cancelado ou não realizado;
- este arquivo nunca é uma ordem de envio.

## Rubrica obrigatória

Pontuar de `0` a `2`:

| Dimensão | Nota |
|---|---:|
| evidência e relevância | |
| clareza | |
| personalização | |
| conformidade e opt-out | |
| brevidade e CTA | |
| **Total** | **/10** |

A mensagem somente pode receber `APROVADO_NOT_SENT` com total mínimo `8/10`, nenhuma dimensão em zero e todos os gates individuais e globais comprovados.

## Checklist de aprovação por lead

| Campo | Preenchimento obrigatório antes de qualquer contato manual |
|---|---|
| Código sanitizado | `[PREENCHER]` |
| Segmento | `[PREENCHER]` |
| Região | `[PREENCHER]` |
| Diagnóstico aprovado | `NO_SITE, THIRD_PARTY_ONLY, WEAK_SITE, BROKEN_SITE ou WEAK_CONVERSION` |
| Canal selecionado | `WHATSAPP` ou `EMAIL` |
| Evidência de elegibilidade do canal | `[PREENCHER / REGISTRAR FORA DO REPOSITÓRIO]` |
| Supressões específicas | `[LIMPO / BLOQUEADO / NÃO COMPROVADO]` |
| Responsável pela aprovação | `Bruno F. Salustiano` |
| Template | `pilot-whatsapp-first-contact` ou `pilot-email-first-contact` |
| Versão | `v1` |
| Nota da rubrica | `[MÍNIMO 8/10; NENHUMA DIMENSÃO ZERO]` |
| Data/hora UTC de aprovação | `[PREENCHER]` |
| Texto final aprovado | `[REGISTRAR EM ARMAZENAMENTO PRIVADO]` |
| Decisão individual | `APROVADO_NOT_SENT, NEEDS_ADJUSTMENT, REJEITADO ou DO_NOT_CONTACT` |
| Estado da issue #117 | `REAL_MANUAL_PILOT_READY` obrigatório para executar |
| Critérios de suspensão | `opt-out, NAO_CONTATAR, DO_NOT_CONTACT, bloqueio, contato inválido, incidente ou dúvida sobre elegibilidade` |
| Revisão humana individual | `[CONFIRMAR]` |
| Nenhum envio automático | `[CONFIRMAR]` |
| Nenhum link/preço/anexo/tracking sem autorização | `[CONFIRMAR]` |

Não armazene nome de pessoa física desnecessário, token, telefone, e-mail, payload ou mensagem efetivamente enviada na evidência técnica pública. Use identificador técnico do operador, identificador técnico do lead e os registros auditáveis protegidos pela aplicação.