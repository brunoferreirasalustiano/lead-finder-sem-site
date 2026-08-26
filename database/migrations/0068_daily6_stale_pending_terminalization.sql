BEGIN;

-- Terminalize only an old, never-started Daily-6 collection.  This is an
-- operator recovery primitive for jobs that remained PENDING after the
-- control-plane process stopped before the worker claimed them.  It never
-- requeues an identity and refuses leases, young jobs, non-zero metrics, or
-- any send/idempotency evidence.
CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_stale_daily6_pending(
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
    'daily6:stale-pending-terminalization:' || p_request_identity, 0
  ));

  SELECT j.* INTO job_row
  FROM public.collection_jobs j
  WHERE j.request_identity = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'COLLECTION_JOB_NOT_FOUND';
    RETURN;
  END IF;

  IF job_row.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_PENDING';
    RETURN;
  END IF;
  IF job_row.lease_token IS NOT NULL OR job_row.lease_expires_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'LEASE_PRESENT';
    RETURN;
  END IF;
  IF job_row.created_at > clock_timestamp() - make_interval(secs => p_min_age_seconds) THEN
    RETURN QUERY SELECT false, 'TOO_FRESH';
    RETURN;
  END IF;

  SELECT b.* INTO batch_row
  FROM public.daily6_batches b
  WHERE b.batch_id = p_request_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DAILY6_BATCH_NOT_FOUND';
    RETURN;
  END IF;
  IF batch_row.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'BATCH_NOT_PENDING';
    RETURN;
  END IF;

  -- Any non-zero metric or durable side-effect evidence makes the state
  -- ambiguous.  Leave it untouched for a human/operator investigation.
  IF greatest(
      batch_row.reserved, batch_row.discovered, batch_row.enriched,
      batch_row.auto_approved, batch_row.rejected, batch_row.ready,
      batch_row.sent, batch_row.delivered, batch_row.failed,
      batch_row.ambiguous, batch_row.hard_bounced, batch_row.replies,
      batch_row.positive_replies, batch_row.opt_outs
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
    RETURN QUERY SELECT false, 'SIDE_EFFECT_PRESENT';
    RETURN;
  END IF;

  UPDATE public.collection_jobs j
  SET status = 'FAILED',
      error = 'STALE_PENDING_TERMINALIZED',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE j.id = job_row.id
    AND j.status = 'PENDING'
    AND j.lease_token IS NULL
    AND j.lease_expires_at IS NULL;
  GET DIAGNOSTICS job_updated = ROW_COUNT;

  UPDATE public.daily6_batches b
  SET status = 'FAILED',
      terminal_reason = 'STALE_PENDING_COLLECTION',
      updated_at = clock_timestamp()
  WHERE b.batch_id = p_request_identity
    AND b.status = 'PENDING';
  GET DIAGNOSTICS batch_updated = ROW_COUNT;

  IF job_updated <> 1 OR batch_updated <> 1 THEN
    RETURN QUERY SELECT false, 'CONCURRENT_STATE_CHANGE';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'STALE_PENDING_TERMINALIZED';
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_stale_daily6_pending(text, integer) FROM PUBLIC;

-- This primitive is intentionally owner/operator-only.  It has no table
-- grants and is not exposed to API, discovery, or scheduler runtime roles.

COMMIT;
