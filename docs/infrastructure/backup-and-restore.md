# Backup and restore

Run `BACKUP_OUTPUT=... DIRECT_DATABASE_URL=... scripts/database/export-postgres.sh`. The script creates a private custom-format dump and validates its catalog. Restore only with `CONFIRM_DISPOSABLE_RESTORE=yes`, `RESTORE_DATABASE_URL` and `BACKUP_INPUT`; it refuses by default.

After restore run migrations, `VERIFY_DATABASE_URL=... npx tsx scripts/database/verify-database-migration.ts`, integration tests, row-count/hash comparisons, `setval` checks, constraint/index/trigger/function/RLS/role inventory and an application smoke. A backup is not accepted until a disposable restore succeeds. Roll back by redirecting clients to the untouched source after stopping both processors; never run two primaries.

## Reconciliação obrigatória de supressões

API e worker permanecem parados. Execute `scripts/restore-postgres.sh` a partir da raiz da implantação, informando um dump e um novo arquivo `*.suppression-manifest.json`, ambos diretamente em `BACKUP_DIR`. Exportação, validação, dry-run, aplicação e verificação usam o serviço one-shot `restore-suppression` com `docker compose run --rm`, dentro da rede privada `database`; Node/npm e acesso ao hostname `postgres` não são necessários no host. O runner usa a imagem de API construída pelo lockfile, filesystem somente leitura, capabilities removidas e acesso bind restrito ao diretório dos manifestos.

O JSON canônico v1.0 contém apenas UUID/identidade OSM, escopo, estado monotônico, timestamps e códigos; PII, payloads e segredos são proibidos. O digest é SHA-256 hexadecimal do conteúdo canônico sem o campo `digest`. Mantenha `BACKUP_DIR` acessível somente ao operador e configure `RESTORE_RUNNER_UID`/`RESTORE_RUNNER_GID` para o proprietário do diretório quando a implantação não usa UID/GID 1000.

Após restore e migrations, o script executa dry-run, aplicação transacional, verificação e `pilot:real:preflight -- --restore-suppression-only` no runner. Jobs `ATTEMPT_CREATED` são relacionados por outbox → attempt → recipient → lead; opt-out de canal afeta somente o canal declarado, enquanto supressões globais e de lead afetam todos os canais. Alvos ausentes retornam `RESTORE_SUPPRESSION_BLOCKED/UNRESOLVED_SUPPRESSION_TARGETS`; nunca crie leads substitutos. A evidência mínima fica em `restore_suppression_runs`, sem o manifesto.

O padrão `RESTORE_RESUME_SERVICES=false` mantém API e worker parados mesmo após sucesso. Uma retomada automática exige autorização explícita `RESTORE_RESUME_SERVICES=true` e só ocorre depois de `RESTORE_SUPPRESSION_SAFE` e do preflight pós-commit. Qualquer comando não zero encerra o script antes de `up -d api worker`.

Em falha, mantenha os serviços parados, preserve dump/manifesto com acesso mínimo e repita desde um restore limpo. Após a retenção aprovada, elimine o manifesto com segurança; nunca o versione. Banco comprovadamente novo e vazio exige caminho separado com origem `EMPTY_DATABASE_BOOTSTRAP`, não ausência silenciosa do manifesto.
