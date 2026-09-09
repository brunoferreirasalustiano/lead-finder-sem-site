BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS lead_finder_internal.daily6_scheduler_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO lead_finder_internal.daily6_scheduler_settings(singleton, enabled)
VALUES (true, false)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE lead_finder_internal.daily6_scheduler_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION lead_finder_internal.invoke_daily6_supabase_scheduler()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, vault, net, lead_finder_internal
AS $$
DECLARE
  scheduler_enabled boolean;
  invoke_secret text;
  request_id bigint;
BEGIN
  SELECT enabled INTO scheduler_enabled
    FROM lead_finder_internal.daily6_scheduler_settings
   WHERE singleton = true;

  IF scheduler_enabled IS DISTINCT FROM true THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO invoke_secret
    FROM vault.decrypted_secrets
   WHERE name = 'daily6_scheduler_invoke_secret'
   ORDER BY created_at DESC
   LIMIT 1;

  IF invoke_secret IS NULL OR length(invoke_secret) < 32 THEN
    RAISE EXCEPTION 'DAILY6_SCHEDULER_INVOKE_SECRET_MISSING';
  END IF;

  SELECT net.http_post(
    url := 'https://ondvzdvlwntrnieodifi.supabase.co/functions/v1/daily6-github-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Scheduler-Secret', invoke_secret
    ),
    body := jsonb_build_object('source', 'supabase_cron'),
    timeout_milliseconds := 15000
  ) INTO request_id;

  RETURN request_id;
END
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.invoke_daily6_supabase_scheduler() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  existing_job_id bigint;
  scheduler_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'lead-finder-daily6-supabase'
   LIMIT 1;
  IF existing_job_id IS NULL THEN
    SELECT cron.schedule(
      'lead-finder-daily6-supabase',
      '7 12,16,19 * * *',
      'select lead_finder_internal.invoke_daily6_supabase_scheduler()'
    ) INTO scheduler_job_id;
    PERFORM cron.alter_job(job_id := scheduler_job_id, active := false);
  END IF;
END
$$;

COMMIT;
