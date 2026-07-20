# Backup and restore

Run `BACKUP_OUTPUT=... DIRECT_DATABASE_URL=... scripts/database/export-postgres.sh`. The script creates a private custom-format dump and validates its catalog. Restore only with `CONFIRM_DISPOSABLE_RESTORE=yes`, `RESTORE_DATABASE_URL` and `BACKUP_INPUT`; it refuses by default.

After restore run migrations, `VERIFY_DATABASE_URL=... npx tsx scripts/database/verify-database-migration.ts`, integration tests, row-count/hash comparisons, `setval` checks, constraint/index/trigger/function/RLS/role inventory and an application smoke. A backup is not accepted until a disposable restore succeeds. Roll back by redirecting clients to the untouched source after stopping both processors; never run two primaries.
