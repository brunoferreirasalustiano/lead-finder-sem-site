# Métricas de qualidade

Limiar é hipótese inicial, não resultado. Calcular por período, segmento, região, score e origem, usando agregados/pseudônimos.

| Métrica | Fórmula | Fonte/frequência | Limiar | Distorção e ação abaixo |
|---|---|---|---|---|
| Total captado | únicos criados | captação/DB, diária | n/a | reprocessamento; deduplicar |
| Sem site | confirmadas/revisadas | revisão, semanal | ≥85% | viés; revisar evidência/score |
| Presença inadequada | inadequadas/revisadas | revisão, semanal | por segmento | subjetividade; rubricar |
| Contato válido | com contato validado/qualificados | contatos, diária | ≥70% | fonte; priorizar validação |
| Telefone válido | validados/avaliados | contatos, semanal | ≥70% | formato; normalizar/amostrar |
| WhatsApp provável | prováveis/telefones válidos | qualificação, semanal | informativo | não confirma; nunca enviar |
| WhatsApp confirmado | confirmações auditáveis/telefones válidos | CRM, semanal | informativo | consentimento; registrar origem |
| E-mail válido | validados/avaliados | contatos, semanal | ≥60% | falha de verificador; amostrar |
| Duplicidade | detectados/captados | dedupe, diária | ≤5% | chaves; normalizar |
| Empresa bloqueada | bloqueados/avaliados | bloqueio, diária | informativo | subregistro; auditar |
| Opt-out | opt-outs/abordados | CRM, semanal | ≤5% | baixo volume; pausar/revisar |
| Falso positivo | rejeitados/revisados | revisão, semanal | ≤15% | viés; recalibrar |
| Score por segmento | distribuição e precisão por faixa | score+revisão, semanal | monotônico | não generaliza; recalibrar |
| Cobertura geográfica | regiões com amostra/regiões do escopo | captação, semanal | 100% | densidade; limitar alegação |
| Precisão | confirmações/revisões conclusivas | revisão, semanal | ≥85% | revisores; dupla revisão |
| Oportunidade | oportunidades/qualificados revisados | CRM, quinzenal | por oferta | oferta/coorte; comparar |

## Amostragem humana

Revisar score alto, intermediário, rejeitados, falsos positivos, contatos duvidosos e amostras por região/segmento. Mínimo: 30 conclusivos por estrato; se menor, revisar toda a população e registrar limitação. Revisor comercial treinado; 10% recebe segunda revisão. Aprovação exige evidência sanitizada; rejeição usa motivo codificado. Atualizar score somente após análise de coorte aprovada; sortear dentro de estratos para reduzir viés.
