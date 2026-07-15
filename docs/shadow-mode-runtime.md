# Shadow Mode Runtime

`SHADOW_MODE_ENABLED=false` é o padrão; somente `true` e `false` são aceitos. Quando `true`, o worker bloqueia antes de claim, autorização e adapter: registra `SHADOW_MODE_BLOCKED`, incrementa o contador interno e não registra payload, contato, mensagem ou segredo. Não há provider, webhook ou rede de campanha.

Use `npx tsx scripts/shadow-mode.ts start <runId>` e `status <runId>` para a evidência local. O runtime expõe início/finalização/abort idempotentes, snapshots JSON agregados e relatório com funil comercial `NOT_RUN`. Abort usa motivo seguro e permite relatório parcial. Rollback: parar o worker, manter `SHADOW_MODE_ENABLED=false`, preservar apenas relatório sanitizado e descartar evidência segundo retenção aprovada.

`NO_GO` é obrigatório diante de incidente crítico, ausência de evidência, limites de qualidade falhos ou ausência de readiness/backup/rollback/relatório. Contatos válidos usam `totalValidContacts / totalCollected`, mínimo padrão configurável de 70% inclusivo; zero coletados é `NOT_RUN` e nunca aprova. Shadow não aprova piloto manual.
