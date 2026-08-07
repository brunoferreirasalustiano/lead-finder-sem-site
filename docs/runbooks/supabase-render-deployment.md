# Supabase + Render deployment

1. Create a Supabase Free project manually. Use the direct URL for migrations/backup and session pooler for Render where needed; require TLS. Apply repository migrations through one approved mechanism per environment; never recreate schema ad hoc in Dashboard.
2. Before every Render deploy, confirm the exact database referenced by the target service without exposing its connection string.
3. Query both migration registries when they exist:
   - `public.schema_migrations.version`, used by the repository runner;
   - `supabase_migrations.schema_migrations.name`, used by Supabase MCP/CLI migrations.
4. Compare logical migration names from both registries with the repository migration directory and the effective PostgreSQL catalog.
5. Classify each migration as `LOCAL`, `SUPABASE`, `BOTH` or `PENDING`. Any conflicting name/version, imported migration without a parity validator or catalog mismatch must stop the deploy.
6. The runner integrated by PR #121 supports split registries. For `0019/0020`, it validates tables, foreign keys, triggers, RLS and ACL before accepting a Supabase record, does not insert artificial local history and does not execute DDL for imported migrations.
7. Never re-run an imported migration or insert a local history row manually. If a migration is absent from both histories but its objects already exist, stop and produce a sanitized parity snapshot covering columns, defaults, constraints, foreign keys, indexes, functions, triggers, RLS, grants and row counts.
8. Verify RLS/grants and run database advisors. A deny-all table may intentionally have RLS enabled with no policies, but `PUBLIC`, `anon` and `authenticated` must have no effective access. Put `service_role` nowhere in the frontend.
9. Confirm append-only manual-messaging tables grant `service_role` only `SELECT` and `INSERT`; verify mutation guards and state-transition triggers before deploy.
10. Confirm backup/restore applicability and a rollback path before changing the effective environment.
11. After an approved `npm run db:migrate`, run `npm run db:provision:hml-runtime` against the same direct PostgreSQL target. This reapplies the HML runtime allowlist after the migration deny/revoke boundary and must complete before the API is started or released.
12. Create or update the Render service manually from `render.yaml`; enter secrets only in Render. Confirm target service, database, branch, commit SHA, auto-deploy state and fail-closed flags before initiating a controlled deploy.
13. Required effective flags for the current pilot gate:
    - `DEPLOYMENT_PROFILE=supabase-render`;
    - `DRY_RUN=true`;
    - `SHADOW_MODE_ENABLED=true`;
    - `REAL_SEND_ENABLED=false`;
    - `REAL_PROVIDERS_ENABLED=false`;
    - `REAL_PROVIDER_CONFIGURED=false`;
    - `COLLECTION_EGRESS_ENABLED=false`.
14. Do not reveal `DATABASE_URL`, tokens or other secrets in logs, issues, PRs or evidence. Record only `MATCH`, `MISMATCH` or `NOT_ACCESSIBLE` for the target Supabase project.
15. Deploy only a reviewed SHA with CI integralmente green. Auto-deploy must remain off during the controlled gate.
16. Verify `/health/live`, `/health/ready`, cold start and hibernation recovery. Do not add keep-alive traffic.
17. Review sanitized logs, test restart and kill switch in a controlled window, and confirm no observed egress to SMTP, Meta, OpenAI or webhooks while real providers remain disabled.
18. Prove rollback and repeat the smoke test. Stop immediately on migration, database, flag, provider, egress, PII or suppression divergence.
19. With Supabase CLI, inspect `supabase --help`, set `CRON_INVOKE_SECRET`, `INTERNAL_CRON_SECRET`, and `RENDER_INTERNAL_BATCH_URL`, then deploy the Edge Function from `deploy/supabase/functions/process-lead-batch` only when that optional profile is explicitly approved.
20. Test unauthorized and authorized calls with a unique `Idempotency-Key`; confirm dry-run and aggregate-only response.
21. Review `deploy/supabase/cron/six-daily-runs.example.sql`, store the invoke token in Vault, and manually create at most six jobs. No SQL in the repository activates jobs.
22. Pause/remove each job with `cron.unschedule`, then confirm no recent runs before disabling Plan B.

The current pilot does not authorize provider, webhook, automated outreach or real message delivery. The repository has no frontend application today. A future static bundle should use `PUBLIC_API_URL`, restrictive CSP/CORS and Render Static Site or GitHub Pages; no privileged key may enter its bundle.
