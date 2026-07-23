# Métricas de sucesso do primeiro lote manual

## Finalidade

Definir como avaliar o primeiro lote real de até cinco negócios sem confundir preparação, abertura do cliente, envio confirmado, entrega, leitura ou resposta.

Este documento não autoriza contato. O lote somente pode começar após o veredito explícito `REAL_MANUAL_PILOT_READY` na issue #117 e aprovação individual de Bruno F. Salustiano para cada lead.

## Princípios

- `OPENED` significa que o operador abriu o cliente oficial; não prova envio, entrega ou leitura.
- `SENT_CONFIRMED` significa apenas que o operador confirmou manualmente o envio.
- Sem provider e sem tracking, entrega, abertura e leitura não são métricas disponíveis.
- Respostas somente contam quando registradas como evento humano auditável.
- Com lote de até cinco leads, publicar contagens absolutas; percentuais são auxiliares e nunca prova estatística.
- Denominador zero é `NOT_RUN`, nunca 0%.
- Nenhuma métrica pode exigir PII em issue, log ou artifact público.

## Contagens operacionais

Registrar por lote e por canal:

- `candidates_reviewed`;
- `leads_approved`;
- `messages_prepared`;
- `opened_by_operator`;
- `sent_confirmed`;
- `not_sent`;
- `invalid_contact`;
- `channel_unavailable`;
- `operational_error`;
- `positive_reply`;
- `negative_reply`;
- `opt_out`;
- `incidents`;
- `human_minutes_total`.

## Fórmulas permitidas

Somente calcular quando o denominador for maior que zero:

- taxa de execução manual = `sent_confirmed / leads_approved`;
- taxa de resposta = `(positive_reply + negative_reply + opt_out) / sent_confirmed`;
- taxa de resposta positiva = `positive_reply / sent_confirmed`;
- taxa de opt-out = `opt_out / sent_confirmed`;
- taxa de problema de canal = `(invalid_contact + channel_unavailable) / contact_confirmation_events`;
- taxa de conclusão auditável = `terminal_confirmation_events / messages_prepared`;
- tempo humano médio por lead aprovado = `human_minutes_total / leads_approved`.

`terminal_confirmation_events` inclui `SENT_CONFIRMED`, `NOT_SENT`, `INVALID_CONTACT`, `CHANNEL_UNAVAILABLE` e `OPERATIONAL_ERROR`.

## Rubrica de qualidade da mensagem

Cada mensagem é revisada antes da aprovação individual. Pontuar de 0 a 2 em cada dimensão:

| Dimensão | 0 | 1 | 2 |
|---|---|---|---|
| Evidência e relevância | afirmação não comprovada | evidência genérica | diagnóstico verificável e pertinente |
| Clareza | confusa ou ambígua | compreensível com excesso | direta e fácil de responder |
| Personalização | inventa ou presume | pouco específica | usa apenas fatos verificados |
| Conformidade | falta identificação/saída | parcialmente completa | identidade, finalidade e opt-out claros |
| Brevidade e CTA | longa ou pressionadora | aceitável | curta, permission-first e sem pressão |

Critério de aprovação da copy:

- nota total mínima: `8/10`;
- nenhuma dimensão pode receber `0`;
- nenhum link, imagem, PDF, preço, proposta ou tracking no primeiro contato;
- nenhuma alegação de resultado, urgência artificial ou conhecimento não comprovado.

## Métricas de qualidade do projeto

Estes indicadores são gates duros e devem permanecer em zero:

- `unauthorized_send_count`;
- `duplicate_send_count`;
- `suppression_violation_count`;
- `do_not_contact_violation_count`;
- `nao_contatar_violation_count`;
- `pii_public_exposure_count`;
- `unexpected_provider_or_egress_count`;
- `invalid_state_transition_count`;
- `untracked_manual_result_count`.

Evidências obrigatórias antes do lote:

- CI verde no SHA exato implantado;
- flags efetivas fail-closed verificadas;
- auto-deploy desligado;
- restart controlado aprovado;
- kill switch aprovado;
- backup, restore e rollback comprovados;
- schema e histórico de migrations reconciliados;
- logs sanitizados;
- zero canais aprovados sem revisão humana;
- zero WhatsApp frio sem opt-in explícito.

## Vereditos do lote

- `SAFE_EXECUTION_CONFIRMED`: todos os gates duros em zero e todos os registros possuem estado terminal auditável.
- `PROMISING_COMMERCIAL_SIGNAL`: execução segura e pelo menos uma resposta positiva ou autorização explícita para continuar a conversa.
- `NEEDS_COPY_OR_CHANNEL_ADJUSTMENT`: execução segura, mas sem sinal comercial suficiente para repetir a mesma hipótese.
- `STOPPED_BY_INCIDENT`: qualquer violação de supressão, envio não autorizado, PII pública, duplicidade ou egress inesperado.
- `NOT_RUN`: nenhum envio confirmado.

Uma resposta positiva não valida o produto inteiro. O primeiro lote serve para verificar segurança operacional, qualidade da abordagem e existência de sinal comercial inicial.

## Relatório sanitizado

O relatório público deve conter somente:

- ID do lote;
- período;
- segmento e região em nível agregado;
- contagens e fórmulas acima;
- distribuição das notas de qualidade, sem mensagem integral;
- incidentes por categoria, sem PII;
- veredito do lote;
- decisão `CONTINUE`, `ADJUST` ou `STOP`.

## Critério de prontidão

`FIRST_BATCH_SUCCESS_METRICS_READY`
