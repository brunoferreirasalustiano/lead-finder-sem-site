# Supabase + Render deployment

1. Create a Supabase Free project manually. Use the direct URL for migrations/backup and session pooler for Render where needed; require TLS. Apply repository migrations, never recreate schema in Dashboard.
2. Before every Render deploy, query `schema_migrations` through the exact `DATABASE_URL` configured on the target service and compare it with the repository migration directory and the effective PostgreSQL catalog. If a migration version is absent but its objects already exist, stop: do not re-run the migration and do not insert a history row blindly. Produce a sanitized parity snapshot covering columns, defaults, constraints, foreign keys, indexes, functions, triggers, RLS, grants and row counts; identify the source of drift; create a backup/restore point; then reconcile through an explicit, reviewed transaction.
3. Verify RLS/grants and run database advisors. A deny-all table may intentionally have RLS enabled with no policies, but `PUBLIC`, `anon` and `authenticated` must have no effective access. Put `service_role` nowhere in the frontend.
4. Confirm append-only manual-messaging tables grant `service_role` only `SELECT` and `INSERT`; verify mutation guards and state-transition triggers before deploy.
5. Create the Render Blueprint manually from `render.yaml`; enter secrets in Render. Confirm the target service, branch, commit SHA, auto-deploy state and fail-closed flags before initiating a controlled deploy.
6. Verify `/health/live`, `/health/ready`, cold start and hibernation recovery. Do not add keep-alive traffic.
7. Review sanitized logs, test restart and kill switch in a controlled window, and confirm no observed egress to SMTP, Meta, OpenAI or webhooks while real providers remain disabled.
8. With Supabase CLI, inspect `supabase --help`, set `CRON_INVOKE_SECRET`, `INTERNAL_CRON_SECRET`, and `RENDER_INTERNAL_BATCH_URL`, then deploy the Edge Function from `deploy/supabase/functions/process-lead-batch` only when that optional profile is explicitly approved.
9. Test unauthorized and authorized calls with a unique `Idempotency-Key`; confirm dry-run and aggregate-only response.
10. Review `deploy/supabase/cron/six-daily-runs.example.sql`, store the invoke token in Vault, and manually create at most six jobs. No SQL in the repository activates jobs.
11. Pause/remove each job with `cron.unschedule`, then confirm no recent runs before disabling Plan B.

The repository has no frontend application today. A future static bundle should use `PUBLIC_API_URL`, restrictive CSP/CORS and Render Static Site or GitHub Pages; no privileged key may enter its bundle.
