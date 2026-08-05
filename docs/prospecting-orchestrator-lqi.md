# Base de LQI e métricas do orquestrador de prospecção

## Objetivo

Esta etapa cria um contrato TypeScript puro para qualificar leads sintéticos de salões de beleza e cabeleireiros e agregar métricas de cada rodada por cidade. Ela não pesquisa fontes públicas, não persiste dados, não agenda rodadas e não chama providers.

O material visual de referência apresenta demonstrações fictícias de presença digital para pequenos negócios. Nesta etapa, ele é somente contexto de produto; nenhuma informação de contato ou registro externo é importada.

## Fórmula do score

O `Lead Quality Index` (LQI) é a soma determinística dos pesos abaixo. Cada evidência vale o peso inteiro quando `true` e zero quando `false`.

| Evidência | Peso |
|---|---:|
| atividade aparente | 20 |
| ausência de domínio oficial | 25 |
| e-mail empresarial público confiável | 25 |
| ausência de contato anterior | 15 |
| ausência de supressão ou bounce | 15 |

O total é limitado ao intervalo `[0, 100]` e o limiar desta etapa é `80`.

## Gates obrigatórios e decisão

Score e elegibilidade são decisões diferentes. As evidências alimentam o score; `blockingReasons` representa os gates de segurança que foram reprovados ou ficaram ambíguos. A ausência de bloqueios significa que os gates fornecidos para a avaliação passaram.

Um lead só é elegível quando o score é pelo menos `80`, não há `blockingReasons`, a evidência tem formato válido e não há ambiguidade ou insuficiência total de evidência. Qualquer razão de bloqueio, incluindo contato anterior, duplicidade, bounce, opt-out, `DO_NOT_CONTACT`, `NAO_CONTATAR`, bloqueio, reclamação ou falha de auditoria, torna `eligible` falso mesmo com score alto. Resultado ambíguo e entrada inválida falham fechado como `AMBIGUOUS_RESULT`.

## Motivos padronizados

Os motivos de bloqueio são:

`INACTIVE_OR_UNCERTAIN_ACTIVITY`, `OFFICIAL_DOMAIN_FOUND`, `BUSINESS_EMAIL_NOT_CONFIRMED`, `PREVIOUS_CONTACT_FOUND`, `DUPLICATE_FOUND`, `BOUNCE_FOUND`, `OPT_OUT_FOUND`, `DO_NOT_CONTACT`, `NAO_CONTATAR`, `BLOCKED`, `COMPLAINT_FOUND`, `AUDIT_FAILURE` e `AMBIGUOUS_RESULT`.

Os motivos de rejeição incluem todos os motivos acima e também `SCORE_BELOW_THRESHOLD` e `INSUFFICIENT_EVIDENCE`. A saída deduplica e ordena motivos de bloqueio de forma determinística.

## Contrato de métricas por rodada

`buildProspectingRunMetrics` recebe somente a cidade e contadores agregados sem e-mail, telefone, nome pessoal ou identificador de contato. O contrato inclui:

- `found`, `approved`, `rejected`;
- `sentAcceptedByProvider`, `immediateBounces`, `optOuts`, `replies`, `complaints`, `blocked`, `duplicatesAvoided`;
- `officialDomainsFound`, `missingBusinessEmails`, `inactiveOrUncertain`, `ambiguousResults`;
- `scoreDistribution` em cinco faixas fixas: `0-19`, `20-39`, `40-59`, `60-79` e `80-100`.

As taxas são calculadas assim:

```text
approvalRate = approved / found
sendRateAmongApproved = sentAcceptedByProvider / approved
```

Quando o denominador é zero, a taxa é `0`. A distribuição precisa somar exatamente `found`; contadores inválidos ou cidade vazia são rejeitados para evitar métricas silenciosamente incorretas.

`sentAcceptedByProvider` significa apenas aceitação síncrona pelo provider. Não significa entrega, leitura, resposta ou sucesso comercial confirmado. Esta PR não habilita Gmail, outro provider ou qualquer envio.

## Limitações desta PR

- não há migration, persistência PostgreSQL ou schema hospedado;
- não há scheduler, pesquisa pública, mudança automática de cidade ou critério de saturação;
- não há dashboard, API interna ou integração Supabase hospedada;
- não há provider real, envio de e-mail, WhatsApp, Gmail, secrets ou deploy;
- métricas são contratos em memória e devem receber somente fixtures sintéticas.

## Próximos passos

1. persistência PostgreSQL;
2. migration incremental;
3. cidade atual e histórico de transição;
4. scheduler;
5. API interna;
6. dashboard;
7. integração Gmail/Supabase sob feature flags e gates de segurança.
