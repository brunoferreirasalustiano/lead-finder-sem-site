# Checklist executável — shadow mode

Dados reais apenas para observação/revisão; contato, provider, webhook, SDK e rede externa permanecem desabilitados.

## Antes
- [ ] Banco/migrations, SHA e ambiente registrados.
- [ ] Backup e restore verificado; readiness/snapshot registrado.
- [ ] Limites, região, segmento, fonte, retenção/descarte e acesso aprovados.
- [ ] Dedupe, bloqueio/opt-out, revisor e amostra verificados.
- [ ] Confirmação independente de ausência de envio; pausa/rollback e responsável definidos.

## Durante
- [ ] Registrar volume, erros, backlog, processamento, duplicidade, FP e contatos por janela/amostra.
- [ ] Registrar incidentes sem PII; pausar imediatamente diante de risco de contato, vazamento ou bloqueio/opt-out falho.
- [ ] Não promover dados para lista de contato.

## Depois
- [ ] Exportar evidência sanitizada, concluir amostra/métricas e analisar FP.
- [ ] Propor score sem alterar produção; registrar go/no-go, riscos e responsáveis.
- [ ] Descartar/reter apenas com autorização; encerrar e preservar auditoria.
