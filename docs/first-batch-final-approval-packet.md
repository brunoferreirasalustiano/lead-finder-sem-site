# Pacote de aprovação final do primeiro lote

## Objetivo

Padronizar a apresentação dos leads elegíveis para decisão de Bruno F. Salustiano antes de qualquer contato manual.

O pacote contém no máximo cinco fichas privadas. A presença de uma ficha não autoriza envio; a aprovação deve ser explícita e individual, e o gate global da issue #117 precisa ter emitido `REAL_MANUAL_PILOT_READY`.

## Capa do lote

- lote ID;
- categoria;
- região;
- quantidade de candidatos pesquisados;
- quantidade excluída;
- quantidade sem canal elegível;
- quantidade apresentada para aprovação;
- SHA da `main` usado como baseline;
- SHA efetivamente implantado na homologação;
- CI verde no SHA exato implantado: `SIM | NÃO | NÃO COMPROVADO`;
- status do aviso de privacidade;
- status do Render e health checks;
- status do histórico de migrations;
- status de backup, restore, rollback e kill switch;
- veredito do ensaio sintético;
- estado global da issue #117;
- data da revisão.

## Ficha por lead

### 1. Identidade

- código sanitizado:
- ID interno:
- nome empresarial:
- categoria:
- cidade/região:
- atividade confirmada: `SIM | NÃO`;
- fontes revisadas:
- risco de homônimo: `BAIXO | MÉDIO | ALTO`;
- identidade vinculada ao canal com segurança: `SIM | NÃO`;

### 2. Oportunidade digital

- diagnóstico principal: `NO_SITE | THIRD_PARTY_ONLY | WEAK_SITE | BROKEN_SITE | WEAK_CONVERSION`;
- presença institucional atual:
- evidência primária:
- evidência secundária:
- problema ou oportunidade observada sem alegação não verificada:
- inspeção reproduzível: `SIM | NÃO`;
- risco de diagnóstico enganoso: `BAIXO | MÉDIO | ALTO`;
- demonstração relacionada:

Ter site não exclui automaticamente o negócio. A ficha deve ser rejeitada quando a oportunidade não estiver demonstrada de forma objetiva.

### 3. Canal

- canal proposto: `EMAIL | WHATSAPP | NENHUM`;
- contato pertence ao lead: `SIM | NÃO`;
- fonte do canal: `NÍVEL_A | NÍVEL_B | NÍVEL_C`;
- fundamento:
- propriedade do e-mail: `BUSINESS | PERSONAL | UNKNOWN | N/A`;
- decisão humana do e-mail: `APPROVED | REJECTED | N/A`;
- origem de opt-in WhatsApp: `DIRECT_OPT_IN | FORM_OPT_IN | SIGNED_RECORD | N/A`;
- observação de elegibilidade:

Regras:

- `BUSINESS_CANDIDATE` não equivale a `BUSINESS / APPROVED`;
- fonte Nível B isolada não aprova automaticamente o e-mail;
- fonte Nível C nunca habilita contato;
- telefone ou botão público de WhatsApp não constitui opt-in.

### 4. Supressões

- opt-out de canal: `LIMPO | BLOQUEADO | NÃO COMPROVADO`;
- opt-out global: `LIMPO | BLOQUEADO | NÃO COMPROVADO`;
- `do_not_contact`: `FALSE | TRUE | NÃO COMPROVADO`;
- `NAO_CONTATAR`: `FALSE | TRUE | NÃO COMPROVADO`;
- bloqueio administrativo: `AUSENTE | PRESENTE | NÃO COMPROVADO`;
- contato inválido: `NÃO | SIM | NÃO COMPROVADO`;
- verificado em:
- verificação vinculada ao lead/contato correto: `SIM | NÃO`;

Qualquer estado restritivo transforma a decisão em `DO_NOT_CONTACT`. Qualquer estado `NÃO COMPROVADO` impede aprovação.

### 5. Mensagem

- template ID:
- versão:
- variáveis utilizadas:
- contém identificação do remetente: `SIM | NÃO`;
- informa finalidade: `SIM | NÃO`;
- informa origem do e-mail, quando aplicável: `SIM | NÃO | N/A`;
- oferece opt-out simples: `SIM | NÃO`;
- contém link: `NÃO` obrigatório;
- contém PDF, imagem, preço, proposta ou tracking: `NÃO` obrigatório;
- contém alegação não comprovada: `NÃO` obrigatório;
- texto individual para revisão:

A mensagem integral permanece no pacote privado, não em issue pública.

### 6. Rubrica de qualidade

Pontuar cada dimensão de `0` a `2`:

| Dimensão | Nota | Evidência curta |
|---|---:|---|
| evidência e relevância | | |
| clareza | | |
| personalização | | |
| conformidade e opt-out | | |
| brevidade e CTA | | |
| **Total** | **/10** | |

Requisitos:

- total mínimo `8/10`;
- nenhuma dimensão em zero;
- diagnóstico citado somente quando comprovado;
- CTA compatível com primeiro contato individual;
- mensagem sem pressão, urgência artificial ou promessa de resultado.

### 7. Gate técnico

- health/live: `PASS | FAIL | NÃO COMPROVADO`;
- health/ready: `PASS | FAIL | NÃO COMPROVADO`;
- SHA implantado confirmado: `PASS | FAIL | NÃO COMPROVADO`;
- CI verde no SHA implantado: `PASS | FAIL | NÃO COMPROVADO`;
- banco efetivo confirmado: `PASS | FAIL | NÃO COMPROVADO`;
- histórico de migrations reconciliado: `PASS | FAIL | NÃO COMPROVADO`;
- flags fail-closed efetivas: `PASS | FAIL | NÃO COMPROVADO`;
- kill switch: `PASS | FAIL | NÃO COMPROVADO`;
- backup/restore: `PASS | FAIL | NÃO COMPROVADO`;
- rollback e smoke test: `PASS | FAIL | NÃO COMPROVADO`;
- ensaio sintético no SHA: `PASS | FAIL | NÃO COMPROVADO`;
- zero provider/egress: `PASS | FAIL | NÃO COMPROVADO`;
- veredito #117: `REAL_MANUAL_PILOT_READY | REAL_MANUAL_PILOT_BLOCKED`;

Nenhuma ficha pode ser aprovada com item técnico `FAIL` ou `NÃO COMPROVADO` em gate obrigatório.

### 8. Decisão de Bruno

Decisões permitidas:

- `APROVADO_NOT_SENT`;
- `REJEITADO`;
- `NEEDS_ADJUSTMENT`;
- `DO_NOT_CONTACT`.

Campos:

- decisão:
- data/hora:
- observação:
- janela manual planejada:
- canal oficial a ser utilizado:
- confirmação de que a decisão não representa envio: `SIM | NÃO`;

A decisão `APROVADO_NOT_SENT` somente habilita a execução manual posterior quando o estado global for `REAL_MANUAL_PILOT_READY`. Ela não representa envio e não habilita provider, worker ou automação.

## Após a decisão

### Quando aprovado e o gate global estiver pronto

1. Revalidar supressões imediatamente antes da preparação.
2. Preparar usando o contato persistido.
3. Conferir mensagem, canal e versão.
4. Confirmar que o gate #117 continua `REAL_MANUAL_PILOT_READY`.
5. Abrir o cliente oficial.
6. Registrar `OPENED`.
7. Enviar ou cancelar manualmente.
8. Registrar `SENT_CONFIRMED` ou `NOT_SENT`.
9. Registrar resposta e opt-out separadamente, sem copiar conteúdo sensível para evidência pública.

### Quando rejeitado, bloqueado ou com gate global pendente

- não preparar;
- não abrir link;
- não contatar por outro canal como contorno;
- manter `NOT_SENT`;
- registrar justificativa sanitizada;
- aplicar `DO_NOT_CONTACT` quando pertinente;
- não reativar automaticamente após nova evidência.

## Resumo do lote para aprovação

| Posição | Código | Negócio | Diagnóstico | Canal | Supressões | Nota | Gate técnico | Decisão |
|---|---|---|---|---|---|---:|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |

## Critério de saída

O lote está pronto para decisão somente quando todas as fichas apresentadas estiverem completas, sem PII pública, com supressões específicas comprovadas, nota mínima `8/10`, nenhuma dimensão em zero e estado:

`FIRST_BATCH_AWAITING_HUMAN_APPROVAL`

Esse estado não autoriza contato. A execução manual somente poderá ocorrer após aprovação individual e veredito global `REAL_MANUAL_PILOT_READY`.