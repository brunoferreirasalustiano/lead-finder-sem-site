# Supabase + Render deployment

1. Create a Supabase Free project manually. Use the direct URL for migrations/backup and session pooler for Render where needed; require TLS. Apply repository migrations, never recreate schema in Dashboard.
2. Verify RLS/grants and run database advisors. Put `service_role` nowhere in the frontend.
3. Create the Render Blueprint manually from `render.yaml`; enter secrets in Render. Verify `/health`, `/ready`, cold start and hibernation recovery. Do not add keep-alive traffic.
4. With Supabase CLI, inspect `supabase --help`, set `CRON_INVOKE_SECRET`, `INTERNAL_CRON_SECRET`, and `RENDER_INTERNAL_BATCH_URL`, then deploy the Edge Function from `deploy/supabase/functions/process-lead-batch`.
5. Test unauthorized and authorized calls with a unique `Idempotency-Key`; confirm dry-run and aggregate-only response.
6. Review `deploy/supabase/cron/six-daily-runs.example.sql`, store the invoke token in Vault, and manually create at most six jobs. No SQL in the repository activates jobs.
7. Pause/remove each job with `cron.unschedule`, then confirm no recent runs before disabling Plan B.

The repository has no frontend application today. A future static bundle should use `PUBLIC_API_URL`, restrictive CSP/CORS and Render Static Site or GitHub Pages; no privileged key may enter its bundle.
