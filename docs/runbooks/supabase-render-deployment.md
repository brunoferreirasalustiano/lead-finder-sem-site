# Supabase + Render deployment

1. Create a Supabase Free project manually. Use the direct URL for migrations/backup and session pooler for Render where needed; require TLS. Apply repository migrations through one approved mechanism per environment; never recreate schema ad hoc in Dashboard.
2. Before every Render deploy, confirm the exact database referenced by the target service without exposing its connection string.
3. Query both migration registries when they exist:
   - `public.schema_migrations.version`, used by `scripts/migrate.ts`;
   - `supabase_migrations.schema_migrations.name`, used by Supabase MCP/CLI migrations.
4. Compare the logical migration names from both registries with the repository migration directory and the effective PostgreSQL catalog.
5. If a repository migration is absent from `public.schema_migrations` but present by logical `name` in `supabase_migrations`, classify the environment as `MIGRATION_REGISTRY_SPLIT_VERIFIED`. Do not re-run the migration and do not insert a local history row blindly.
6. Until the runner is compatible with both histories, do not execute `scripts/migrate.ts` against an environment with a split registry. Follow `docs/migration-registry-compatibility.md`.
7. If a migration is absent from both histories but its objects already exist, stop. Produce a sanitized parity snapshot covering columns, defaults, constraints, foreign keys, indexes, functions, triggers, RLS, grants and row counts; identify the source of drift; create a backup/restore point; then reconcile only through an explicit reviewed path.
8. Verify RLS/grants and run database advisors. A deny-all table may intentionally have RLS enabled with no policies, but `PUBLIC`, `anon` and `authenticated` must have no effective access. Put `service_role` nowhere in the frontend.
9. Confirm append-only manual-messaging tables grant `service_role` only `SELECT` and `INSERT`; verify mutation guards and state-transition triggers before deploy.
10. Create the Render Blueprint manually from `render.yaml`; enter secrets in Render. Confirm the target service, database, branch, commit SHA, auto-deploy state and fail-closed flags before initiating a controlled deploy.
11. Verify `/health/live`, `/health/ready`, cold start and hibernation recovery. Do not add keep-alive traffic.
12. Review sanitized logs, test restart and kill switch in a controlled window, and confirm no observed egress to SMTP, Meta, OpenAI or webhooks while real providers remain disabled.
13. With Supabase CLI, inspect `supabase --help`, set `CRON_INVOKE_SECRET`, `INTERNAL_CRON_SECRET`, and `RENDER_INTERNAL_BATCH_URL`, then deploy the Edge Function from `deploy/supabase/functions/process-lead-batch` only when that optional profile is explicitly approved.
14. Test unauthorized and authorized calls with a unique `Idempotency-Key`; confirm dry-run and aggregate-only response.
15. Review `deploy/supabase/cron/six-daily-runs.example.sql`, store the invoke token in Vault, and manually create at most six jobs. No SQL in the repository activates jobs.
16. Pause/remove each job with `cron.unschedule`, then confirm no recent runs before disabling Plan B.

The repository has no frontend application today. A future static bundle should use `PUBLIC_API_URL`, restrictive CSP/CORS and Render Static Site or GitHub Pages; no privileged key may enter its bundle.