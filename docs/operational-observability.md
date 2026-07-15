# Observabilidade operacional

Eventos de shadow usam apenas `runId`, `event`, `outcome`, `reason`, `durationMs`, backlog e contagem de bloqueios. Não usar payload, contatos, mensagens, tokens, segredos ou labels de alta cardinalidade. Eventos: início, conclusão, abort e `SHADOW_MODE_BLOCKED`.
