BEGIN;

-- A discovery failure is a terminal Daily-6 outcome, not an eligible pending
-- batch.  Keep the original collection error as a bounded, PII-safe reason.
ALTER TABLE public.daily6_batches
  ADD COLUMN IF NOT EXISTS terminal_reason text;

ALTER TABLE public.daily6_batches
  DROP CONSTRAINT IF EXISTS daily6_batches_status_check;
ALTER TABLE public.daily6_batches
  ADD CONSTRAINT daily6_batches_status_check
  CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'));

ALTER TABLE public.daily6_batches
  DROP CONSTRAINT IF EXISTS daily6_batches_terminal_reason_check;
ALTER TABLE public.daily6_batches
  ADD CONSTRAINT daily6_batches_terminal_reason_check
  CHECK (terminal_reason IS NULL OR terminal_reason ~ '^[A-Z0-9_:-]{1,120}$');

CREATE OR REPLACE FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(
  p_request_identity text
)
RETURNS TABLE(updated boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_row public.collection_jobs%ROWTYPE;
  batch_row public.daily6_batches%ROWTYPE;
  collection_error_code text;
BEGIN
  IF p_request_identity IS NULL
    OR p_request_identity !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
  THEN
    RETURN QUERY SELECT false, 'INVALID_IDENTITY';
    RETURN;
  END IF;

  -- Serialize the terminal transition with every other reconciler for this
  -- logical identity.  The request identity remains consumed forever.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'daily6:collection-terminal:' || p_request_identity, 0
  ));

  SELECT * INTO job_row
  FROM public.collection_jobs
  WHERE request_identity = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'COLLECTION_JOB_NOT_FOUND';
    RETURN;
  END IF;

  IF job_row.status = 'PROCESSING' THEN
    IF job_row.lease_expires_at IS NOT NULL
      AND job_row.lease_expires_at > clock_timestamp()
    THEN
      RETURN QUERY SELECT false, 'ACTIVE_IN_PROGRESS';
    END IF;
    RETURN QUERY SELECT false, 'AMBIGUOUS_DO_NOT_TOUCH';
    RETURN;
  END IF;
  IF job_row.status = 'COMPLETED' THEN
    RETURN QUERY SELECT false, 'COLLECTION_COMPLETED';
    RETURN;
  END IF;
  IF job_row.status <> 'FAILED' THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_TERMINAL';
    RETURN;
  END IF;
  IF job_row.lease_expires_at IS NULL AND job_row.lease_token IS NOT NULL THEN
    RETURN QUERY SELECT false, 'AMBIGUOUS_DO_NOT_TOUCH';
    RETURN;
  END IF;
  IF job_row.lease_expires_at IS NOT NULL
    AND job_row.lease_expires_at > clock_timestamp()
  THEN
    RETURN QUERY SELECT false, 'ACTIVE_IN_PROGRESS';
    RETURN;
  END IF;

  SELECT * INTO batch_row
  FROM public.daily6_batches
  WHERE batch_id = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DAILY6_BATCH_NOT_FOUND';
    RETURN;
  END IF;
  IF batch_row.status = 'FAILED' THEN
    RETURN QUERY SELECT false, 'ALREADY_TERMINAL';
    RETURN;
  END IF;
  IF batch_row.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'BATCH_NOT_PENDING';
    RETURN;
  END IF;

  -- Any send, preparation, delivery event, outbox record, or idempotency
  -- record makes recovery unsafe.  Unknown and ambiguous states fail closed.
  IF batch_row.ambiguous > 0
    OR EXISTS (
      SELECT 1 FROM public.daily6_send_ledger l
      WHERE l.batch_id = batch_row.batch_id AND l.status = 'AMBIGUOUS'
    )
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_email_send_events e
      JOIN public.pilot_manual_email_send_attempts a ON a.id = e.attempt_id
      JOIN public.pilot_runs p ON p.id = a.pilot_run_id
      WHERE p.name = 'daily6:' || batch_row.batch_id
        AND e.event_type = 'AMBIGUOUS'
    )
  THEN
    RETURN QUERY SELECT false, 'AMBIGUOUS_DO_NOT_TOUCH';
    RETURN;
  END IF;

  IF batch_row.sent > 0
    OR batch_row.reserved > 0
    OR batch_row.delivered > 0
    OR batch_row.failed > 0
    OR EXISTS (SELECT 1 FROM public.daily6_send_ledger l WHERE l.batch_id = batch_row.batch_id)
    OR EXISTS (SELECT 1 FROM public.pilot_runs p WHERE p.name = 'daily6:' || batch_row.batch_id)
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_message_preparations m
      JOIN public.pilot_runs p ON p.id = m.pilot_run_id
      WHERE p.name = 'daily6:' || batch_row.batch_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_email_send_attempts a
      JOIN public.pilot_runs p ON p.id = a.pilot_run_id
      WHERE p.name = 'daily6:' || batch_row.batch_id
    )
    OR EXISTS (
      SELECT 1 FROM public.campaign_outbox o
      WHERE o.idempotency_key LIKE p_request_identity || '|%'
    )
    OR EXISTS (
      SELECT 1 FROM public.crm_idempotency_keys i
      WHERE i.idempotency_key LIKE p_request_identity || '|%'
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_idempotency_keys i
      WHERE i.idempotency_key LIKE p_request_identity || '|%'
    )
  THEN
    RETURN QUERY SELECT false, 'SEND_SIDE_EFFECT_PRESENT';
    RETURN;
  END IF;

  collection_error_code := CASE
    WHEN job_row.error IS NOT NULL AND job_row.error ~ '^[A-Z0-9_]{1,80}$'
      THEN job_row.error
    ELSE 'COLLECTION_FAILED'
  END;
  UPDATE public.daily6_batches
  SET status = 'FAILED',
      terminal_reason = 'COLLECTION_FAILED:' || collection_error_code,
      updated_at = clock_timestamp()
  WHERE batch_id = batch_row.batch_id AND status = 'PENDING';

  IF FOUND THEN
    RETURN QUERY SELECT true, 'COLLECTION_FAILED';
  ELSE
    RETURN QUERY SELECT false, 'CONCURRENT_STATE_CHANGE';
  END IF;
END;
$$;

-- Operator-only entry point for already-created legacy orphans.  It delegates
-- to the same fail-closed checks and never requeues or reopens an identity.
CREATE OR REPLACE FUNCTION lead_finder_internal.reconcile_orphaned_daily6_batch(
  p_batch_id text
)
RETURNS TABLE(updated boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM lead_finder_internal.sync_daily6_batch_from_collection(p_batch_id);
END;
$$;

-- Prevent any future path from resurrecting a terminal batch.
CREATE OR REPLACE FUNCTION lead_finder_internal.prevent_daily6_batch_resurrection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IN ('FAILED', 'BLOCKED', 'COMPLETED')
    AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily6_batch_terminal_guard ON public.daily6_batches;
CREATE TRIGGER daily6_batch_terminal_guard
BEFORE UPDATE ON public.daily6_batches
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.prevent_daily6_batch_resurrection();

-- Direct context preparation must honor the same terminal identity boundary;
-- this prevents creating a new pilot run for a failed batch.
CREATE OR REPLACE FUNCTION lead_finder_internal.prevent_terminal_daily6_pilot_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_status text;
  daily6_batch_id text;
BEGIN
  IF NEW.name LIKE 'daily6:%' THEN
    daily6_batch_id := substr(NEW.name, 8);
    SELECT b.status INTO batch_status
    FROM public.daily6_batches b
    WHERE b.batch_id = daily6_batch_id
    FOR UPDATE;
    IF batch_status IN ('FAILED', 'BLOCKED', 'COMPLETED') THEN
      RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily6_pilot_run_terminal_guard ON public.pilot_runs;
CREATE TRIGGER daily6_pilot_run_terminal_guard
BEFORE INSERT ON public.pilot_runs
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.prevent_terminal_daily6_pilot_run();

-- The durable request identity is consumed even when its collection is
-- terminal.  A deleted/missing job must not make that identity executable
-- again through a direct INSERT or a later enqueue replay.
CREATE OR REPLACE FUNCTION lead_finder_internal.prevent_terminal_daily6_collection_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_status text;
BEGIN
  IF NEW.request_identity IS NOT NULL THEN
    SELECT b.status INTO batch_status
    FROM public.daily6_batches b
    WHERE b.batch_id = NEW.request_identity
    FOR UPDATE;
    IF batch_status IN ('FAILED', 'BLOCKED', 'COMPLETED') THEN
      RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily6_collection_job_terminal_guard ON public.collection_jobs;
CREATE TRIGGER daily6_collection_job_terminal_guard
BEFORE INSERT ON public.collection_jobs
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.prevent_terminal_daily6_collection_job();

-- Keep the normal Daily-6 entry point fail-closed when a request identity has
-- already reached a terminal state.
CREATE OR REPLACE FUNCTION lead_finder_internal.ensure_daily6_batch(
  p_batch_id text,
  p_batch_date date,
  p_slot text,
  p_city_id text,
  p_policy_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  batch_status text;
BEGIN
  IF p_policy_version <> 'daily6-v1'
    OR p_batch_id IS NULL OR btrim(p_batch_id)=''
    OR p_batch_date IS NULL
    OR p_slot NOT IN ('09','13','16')
    OR p_city_id IS NULL OR p_city_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  THEN
    RAISE EXCEPTION 'DAILY6_BATCH_CONTRACT_INVALID' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.daily6_batches(batch_id,batch_date,slot,city_id,policy_version)
  VALUES(p_batch_id,p_batch_date,p_slot,p_city_id,p_policy_version)
  ON CONFLICT (batch_id) DO NOTHING;
  SELECT status INTO batch_status
  FROM public.daily6_batches
  WHERE batch_id = p_batch_id
  FOR UPDATE;
  IF batch_status IN ('FAILED', 'BLOCKED', 'COMPLETED') THEN
    RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL' USING ERRCODE='55000';
  END IF;
END;
$$;

-- The reservation function remains unchanged; this trigger is defense in
-- depth for direct ledger inserts that bypass its terminal-state check.
CREATE OR REPLACE FUNCTION lead_finder_internal.prevent_terminal_daily6_send_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_status text;
BEGIN
  SELECT b.status INTO batch_status
  FROM public.daily6_batches b
  WHERE b.batch_id = NEW.batch_id
  FOR UPDATE;
  IF batch_status IN ('FAILED', 'BLOCKED', 'COMPLETED') THEN
    RAISE EXCEPTION 'DAILY6_BATCH_TERMINAL' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily6_send_ledger_terminal_guard ON public.daily6_send_ledger;
CREATE TRIGGER daily6_send_ledger_terminal_guard
BEFORE INSERT ON public.daily6_send_ledger
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.prevent_terminal_daily6_send_ledger();

REVOKE ALL ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.reconcile_orphaned_daily6_batch(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prevent_daily6_batch_resurrection() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prevent_terminal_daily6_pilot_run() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prevent_terminal_daily6_collection_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prevent_terminal_daily6_send_ledger() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.ensure_daily6_batch(text,date,text,text,text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text)
      TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.ensure_daily6_batch(text,date,text,text,text)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
