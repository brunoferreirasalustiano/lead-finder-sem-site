# Matriz de prontidão comercial

Para sites/landing pages e segmentos configuráveis (`segmento`, `oferta`, `região`, `origem`). Sem provider, envio, rede externa ou aprovação presumida.

## Regra objetiva

Estados: `PASS`, `FAIL`, `PARTIAL`, `NOT RUN`, `NOT APPLICABLE`. Critério aplicável é diferente de `NOT APPLICABLE`; percentual = `100 × PASS / critérios aplicáveis`. `PARTIAL`, `FAIL` e `NOT RUN` valem zero. Bloqueador crítico limita o percentual a 99% e impõe `NO-GO`. Sem evidência datada (SHA, ambiente, responsável, comando/consulta e referência sanitizada) o estado é `NOT RUN`.

| Nível | Requisitos/evidência | Riscos e bloqueadores | Rollback | Decisor | Inicial |
|---|---|---|---|---|---|
| Interno simulado | fixture sem PII, testes e relatório determinístico | contato real ou fixture não representativa | apagar fixture/reverter branch | Tech Lead + QA | NOT RUN |
| Shadow, real sem contato | backup, readiness, snapshot, dedupe, bloqueio/opt-out, retenção, amostra humana, pausa | PII fora da retenção, contato habilitado, incidente sem pausa | pausar, revogar acesso, restore, descarte autorizado | Operação + Segurança | NOT RUN |
| Manual controlado | shadow aprovado, amostra aprovada, CRM, contato individual | contato sem aprovação/bloqueado/opt-out | interromper, `NAO_CONTATAR`, revisar | Comercial + Operação | NOT RUN |
| Automação limitada | manual aprovado, limites, fila/dead-letter, pausa e rollback demonstrados | envio indevido, backlog ou DLQ sem dono | desabilitar execução e congelar fila | Tech Lead + Segurança + Comercial | NOT RUN |
| Produção, um operador | estabilidade, backup, resposta a incidentes e auditoria | regressão de bloqueios/dependência pessoal | desabilitar e congelar fila | Produto + Segurança | NOT RUN |
| Produção, múltiplos clientes | isolamento e governança implementados/testados | vazamento entre clientes | suspender novos clientes/isolar | Produto + Segurança + Arquitetura | NOT APPLICABLE |

## Go/no-go (hipóteses configuráveis, não resultados)

Todos os itens aplicáveis devem ser `PASS`, sem bloqueador e com aprovação humana.

| Transição | Mínimos iniciais | NO-GO obrigatório |
|---|---|---|
| Simulado → shadow | 100% sem envio; relatório sem PII; bloqueio/opt-out testados | rede/envio ou PII no artefato |
| Shadow → manual | precisão ≥85%; FP ≤15%; duplicidade ≤5%; contato válido ≥70%; bloqueado/opt-out contatado = 0; ≥30 por estrato | backup/rollback/rastreabilidade ausente; incidente aberto |
| Manual → automação | aprovação humana ≥95%; oportunidade por coorte; backlog no limite; DLQ não revisada = 0; pausa demonstrada | disparo em massa; opt-out não imediato |
| Automação → um operador | período de estabilidade definido; incidentes críticos abertos = 0; restore, rollback e auditoria PASS | segurança ou pausa falha |
| Um operador → múltiplos | fora desta PR, requer projeto de isolamento | isolamento não testado |

Registrar sempre precisão, falso positivo, duplicidade, contatos, bloqueados, opt-out, backlog, dead-letter, incidentes, pausa, backup/restore, rollback, rastreabilidade e aprovação humana, com denominadores. No shadow runtime, contatos válidos são `totalValidContacts / totalCollected`, com mínimo padrão configurável de 70% inclusivo; zero coletados é `NOT_RUN` e portanto `NO_GO`.

Somente `GET /health`, `GET /health/live` e `GET /health/ready` são públicos. `/internal/operational-snapshot` e todos os endpoints de negócio exigem autenticação e autorização dentro da API; controles de perímetro são apenas defesa em profundidade. Restore sem reconciliação de exclusões/opt-outs posteriores ao backup e qualquer `SHADOW_MODE_ENABLED=false` são `NO-GO`.
