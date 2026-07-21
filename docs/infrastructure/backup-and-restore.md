# Backup and restore

Run `BACKUP_OUTPUT=... DIRECT_DATABASE_URL=... scripts/database/export-postgres.sh`. The script creates a private custom-format dump and validates its catalog. Restore only with `CONFIRM_DISPOSABLE_RESTORE=yes`, `RESTORE_DATABASE_URL` and `BACKUP_INPUT`; it refuses by default.

After restore run migrations, `VERIFY_DATABASE_URL=... npx tsx scripts/database/verify-database-migration.ts`, integration tests, row-count/hash comparisons, `setval` checks, constraint/index/trigger/function/RLS/role inventory and an application smoke. A backup is not accepted until a disposable restore succeeds. Roll back by redirecting clients to the untouched source after stopping both processors; never run two primaries.

## Reconciliação obrigatória de supressões

API e worker permanecem parados. Antes do restore, crie um manifesto privado com `npm run restore:suppression:export -- --output /private/run.suppression-manifest.json` e valide-o. O JSON canônico v1.0 contém apenas UUID/identidade OSM, escopo, estado monotônico, timestamps e códigos; PII, payloads e segredos são proibidos. O digest é SHA-256 hexadecimal do conteúdo canônico sem o campo `digest`.

Após restore e migrations, execute `restore:suppression:apply` sem `--apply`, repita com `--apply --actor <ator-sanitizado>`, execute `restore:suppression:verify` e `pilot:real:preflight -- --restore-suppression-only`. Alvos ausentes retornam `RESTORE_SUPPRESSION_BLOCKED/UNRESOLVED_SUPPRESSION_TARGETS`; nunca crie leads substitutos. A evidência mínima fica em `restore_suppression_runs`, sem o manifesto. Somente `RESTORE_SUPPRESSION_SAFE` permite autorização separada para retomar serviços.

Em falha, mantenha os serviços parados, preserve dump/manifesto com acesso mínimo e repita desde um restore limpo. Após a retenção aprovada, elimine o manifesto com segurança; nunca o versione. Banco comprovadamente novo e vazio exige caminho separado com origem `EMPTY_DATABASE_BOOTSTRAP`, não ausência silenciosa do manifesto.
