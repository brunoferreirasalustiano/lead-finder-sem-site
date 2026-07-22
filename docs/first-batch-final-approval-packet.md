# Pacote de aprovação final do primeiro lote

## Objetivo

Padronizar a apresentação dos leads elegíveis para decisão de Bruno F. Salustiano antes de qualquer contato manual.

O pacote contém no máximo cinco fichas. A presença de uma ficha não autoriza envio; a aprovação deve ser explícita e individual.

## Capa do lote

- lote ID;
- categoria;
- região;
- quantidade de candidatos pesquisados;
- quantidade excluída;
- quantidade sem canal elegível;
- quantidade apresentada para aprovação;
- SHA da aplicação e homologação usados nos gates;
- status do aviso de privacidade;
- status do Render e health checks;
- veredito do ensaio sintético;
- data da revisão.

## Ficha por lead

### 1. Identidade

- ID interno:
- nome empresarial:
- categoria:
- cidade/região:
- atividade confirmada: `SIM | NÃO`;
- fontes revisadas:
- risco de homônimo: `BAIXO | MÉDIO | ALTO`;

### 2. Presença digital

- status do site:
- site próprio funcional: `SIM | NÃO | INCERTO`;
- presença atual: `AGENDA | REDE_SOCIAL | LINK_AGGREGATOR | DIRETÓRIO | OUTRO`;
- problema ou oportunidade observada sem alegação não verificada:
- demonstração relacionada:

### 3. Canal

- canal proposto: `EMAIL | WHATSAPP | NENHUM`;
- contato pertence ao lead: `SIM | NÃO`;
- fundamento:
- propriedade do e-mail: `BUSINESS | PERSONAL | UNKNOWN | N/A`;
- decisão humana do e-mail: `APPROVED | REJECTED | N/A`;
- origem de opt-in WhatsApp: `DIRECT_OPT_IN | FORM_OPT_IN | SIGNED_RECORD | N/A`;
- observação de elegibilidade:

### 4. Supressões

- opt-out de canal: `LIMPO | BLOQUEADO`;
- opt-out global: `LIMPO | BLOQUEADO`;
- `do_not_contact`: `FALSE | TRUE`;
- `NAO_CONTATAR`: `FALSE | TRUE`;
- bloqueio administrativo: `AUSENTE | PRESENTE`;
- verificado em:

Qualquer estado restritivo transforma a decisão em `DO_NOT_CONTACT`.

### 5. Mensagem

- template ID:
- versão:
- variáveis utilizadas:
- contém identificação do remetente: `SIM | NÃO`;
- informa finalidade: `SIM | NÃO`;
- informa origem do e-mail, quando aplicável: `SIM | NÃO | N/A`;
- oferece opt-out simples: `SIM | NÃO`;
- contém link: `NÃO` obrigatório;
- contém PDF, imagem, preço ou proposta: `NÃO` obrigatório;
- texto individual para revisão:

A mensagem integral permanece no pacote privado, não em issue pública.

### 6. Gate técnico

- health/live: `PASS | FAIL | NÃO COMPROVADO`;
- health/ready: `PASS | FAIL | NÃO COMPROVADO`;
- flags fail-closed: `PASS | FAIL | NÃO COMPROVADO`;
- kill switch: `PASS | FAIL | NÃO COMPROVADO`;
- ensaio sintético no SHA: `PASS | FAIL`;
- zero provider/egress: `PASS | FAIL`;

Nenhuma ficha pode ser aprovada com item técnico `FAIL` ou `NÃO COMPROVADO` em gate obrigatório.

### 7. Decisão de Bruno

- `APROVADO_NOT_SENT`;
- `REJEITADO`;
- `NEEDS_ADJUSTMENT`;
- `DO_NOT_CONTACT`.

Campos:

- decisão:
- data/hora:
- observação:
- janela manual planejada:

A decisão `APROVADO_NOT_SENT` permite somente que Bruno realize posteriormente o contato individual no canal oficial. Ela não representa envio.

## Após a decisão

### Quando aprovado

1. Revalidar supressões imediatamente antes da preparação.
2. Preparar usando o contato persistido.
3. Conferir mensagem e canal.
4. Abrir cliente oficial.
5. Registrar `OPENED`.
6. Enviar ou cancelar manualmente.
7. Registrar `SENT_CONFIRMED` ou `NOT_SENT`.
8. Registrar resposta separadamente.

### Quando rejeitado ou bloqueado

- não preparar;
- não abrir link;
- não contatar por outro canal como contorno;
- registrar justificativa sanitizada;
- aplicar `DO_NOT_CONTACT` quando pertinente.

## Resumo do lote para aprovação

| Posição | ID | Negócio | Canal | Fundamento | Supressões | Gate técnico | Decisão |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |

## Critério de saída

O lote está pronto para decisão somente quando todas as fichas forem completas e o estado global permanecer:

`FIRST_BATCH_AWAITING_HUMAN_APPROVAL`
