BEGIN;

-- Keep the discovery worker least-privileged while granting the two location
-- fields that fillMissingLeadCollectionLocation updates for existing leads.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_discovery_runtime') THEN
    GRANT UPDATE (city,state)
      ON TABLE public.leads
      TO lead_finder_discovery_runtime;

    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

-- Owner-only recovery for a worker that died after claiming a collection.
-- It never requeues an identity and refuses active leases, young jobs, any
-- non-zero batch metric, and every known send/idempotency surface.
CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_expired_daily6_processing(
  p_request_identity text,
  p_min_age_seconds integer
)
RETURNS TABLE(updated boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_row public.collection_jobs%ROWTYPE;
  batch_row public.daily6_batches%ROWTYPE;
  job_updated integer;
  batch_updated integer;
BEGIN
  IF p_request_identity IS NULL
    OR p_request_identity !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    OR p_min_age_seconds IS NULL
    OR p_min_age_seconds < 3600
    OR p_min_age_seconds > 604800
  THEN
    RETURN QUERY SELECT false, 'INVALID_ARGUMENT';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'daily6:expired-processing-terminalization:' || p_request_identity, 0
  ));

  SELECT j.* INTO job_row
  FROM public.collection_jobs j
  WHERE j.request_identity = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'COLLECTION_JOB_NOT_FOUND';
    RETURN;
  END IF;
  IF job_row.status <> 'PROCESSING' THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_PROCESSING';
    RETURN;
  END IF;
  IF job_row.lease_token IS NULL OR job_row.lease_expires_at IS NULL THEN
    RETURN QUERY SELECT false, 'AMBIGUOUS_DO_NOT_TOUCH';
    RETURN;
  END IF;
  IF job_row.lease_expires_at >= clock_timestamp() THEN
    RETURN QUERY SELECT false, 'LEASE_NOT_EXPIRED';
    RETURN;
  END IF;
  IF job_row.updated_at > clock_timestamp() - make_interval(secs => p_min_age_seconds) THEN
    RETURN QUERY SELECT false, 'TOO_FRESH';
    RETURN;
  END IF;

  SELECT b.* INTO batch_row
  FROM public.daily6_batches b
  WHERE b.batch_id = p_request_identity
  -- Other terminalizers may hold batch before collection. Never wait while
  -- holding collection: contention aborts this transaction without changes.
  FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DAILY6_BATCH_NOT_FOUND';
    RETURN;
  END IF;
  IF batch_row.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'BATCH_NOT_PENDING';
    RETURN;
  END IF;

  IF greatest(
      coalesce(batch_row.reserved, 0), coalesce(batch_row.discovered, 0),
      coalesce(batch_row.enriched, 0), coalesce(batch_row.auto_approved, 0),
      coalesce(batch_row.rejected, 0), coalesce(batch_row.ready, 0),
      coalesce(batch_row.sent, 0), coalesce(batch_row.delivered, 0),
      coalesce(batch_row.failed, 0), coalesce(batch_row.ambiguous, 0),
      coalesce(batch_row.hard_bounced, 0), coalesce(batch_row.replies, 0),
      coalesce(batch_row.positive_replies, 0), coalesce(batch_row.opt_outs, 0)
    ) > 0
    OR EXISTS (
      SELECT 1 FROM public.daily6_send_ledger l
      WHERE l.batch_id = p_request_identity
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_runs p
      WHERE p.name = 'daily6:' || p_request_identity
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_manual_message_preparations m
      WHERE m.idempotency_key LIKE p_request_identity || '|%'
        OR EXISTS (
          SELECT 1 FROM public.pilot_runs p
          WHERE p.id = m.pilot_run_id AND p.name = 'daily6:' || p_request_identity
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_email_send_attempts a
      JOIN public.pilot_runs p ON p.id = a.pilot_run_id
      WHERE p.name = 'daily6:' || p_request_identity
    )
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_email_send_events e
      JOIN public.pilot_manual_email_send_attempts a ON a.id = e.attempt_id
      JOIN public.pilot_runs p ON p.id = a.pilot_run_id
      WHERE p.name = 'daily6:' || p_request_identity
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

  UPDATE public.collection_jobs j
  SET status = 'FAILED',
      error = 'EXPIRED_PROCESSING_TERMINALIZED',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE j.id = job_row.id
    AND j.status = 'PROCESSING'
    AND j.lease_token = job_row.lease_token
    AND j.lease_expires_at = job_row.lease_expires_at
    AND j.lease_expires_at < clock_timestamp();
  GET DIAGNOSTICS job_updated = ROW_COUNT;

  UPDATE public.daily6_batches b
  SET status = 'FAILED',
      terminal_reason = 'EXPIRED_PROCESSING_COLLECTION',
      updated_at = clock_timestamp()
  WHERE b.batch_id = p_request_identity
    AND b.status = 'PENDING';
  GET DIAGNOSTICS batch_updated = ROW_COUNT;

  IF job_updated <> 1 OR batch_updated <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'CONCURRENT_STATE_CHANGE';
  END IF;

  RETURN QUERY SELECT true, 'EXPIRED_PROCESSING_TERMINALIZED';
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_expired_daily6_processing(text, integer) FROM PUBLIC;

-- This recovery primitive is intentionally owner-only. It is not granted to
-- API, discovery, scheduler, anon, authenticated, or service roles.

COMMIT;
