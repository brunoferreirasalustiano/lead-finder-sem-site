# Checklist shadow mode

- [ ] `SHADOW_MODE_ENABLED=true` validado e nenhum provider/rede de campanha ativo.
- [ ] Backup, readiness, rollback, retenção, dedupe, bloqueio/opt-out e amostra humana registrados.
- [ ] Iniciar run, acompanhar backlog/dead-letter/retries/bloqueios; abortar imediatamente em incidente.
- [ ] Gerar relatório sanitizado, aplicar matriz go/no-go e manter contato/funil comercial como `NOT_RUN`.
