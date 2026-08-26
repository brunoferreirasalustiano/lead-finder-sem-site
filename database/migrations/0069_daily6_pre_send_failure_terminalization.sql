BEGIN;

-- A run-slot failure before the first send must not leave a batch pending
-- forever.  This owner/runtime-guarded primitive only terminalizes a batch
-- after collection is terminal and every send/reservation/idempotency surface
-- is empty.  It never requeues an identity and refuses ambiguous state.
CREATE OR REPLACE FUNCTION lead_finder_internal.terminalize_daily6_without_send(
  p_batch_id text,
  p_reason text,
  p_min_age_seconds integer DEFAULT 0
)
RETURNS TABLE(updated boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_row public.daily6_batches%ROWTYPE;
  collection_status text;
  collection_found boolean;
  batch_updated integer;
BEGIN
  IF p_batch_id IS NULL
    OR p_batch_id !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    OR p_reason IS NULL
    OR p_reason NOT IN ('RUN_SLOT_FAILURE', 'STALE_PENDING_BATCH')
    OR p_min_age_seconds IS NULL
    OR p_min_age_seconds < 0
    OR p_min_age_seconds > 2592000
    OR (p_reason = 'STALE_PENDING_BATCH' AND p_min_age_seconds < 3600)
    OR (p_reason = 'RUN_SLOT_FAILURE' AND p_min_age_seconds <> 0)
  THEN
    RETURN QUERY SELECT false, 'INVALID_ARGUMENT';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'daily6:pre-send-terminalization:' || p_batch_id, 0
  ));

  SELECT b.* INTO batch_row
  FROM public.daily6_batches b
  WHERE b.batch_id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'DAILY6_BATCH_NOT_FOUND';
    RETURN;
  END IF;

  IF batch_row.status IN ('COMPLETED', 'FAILED', 'BLOCKED') THEN
    RETURN QUERY SELECT false, 'ALREADY_TERMINAL';
    RETURN;
  END IF;
  IF batch_row.status NOT IN ('PENDING', 'RUNNING') THEN
    RETURN QUERY SELECT false, 'BATCH_NOT_ACTIVE';
    RETURN;
  END IF;
  IF p_min_age_seconds > 0
    AND batch_row.created_at > clock_timestamp() - make_interval(secs => p_min_age_seconds)
  THEN
    RETURN QUERY SELECT false, 'TOO_FRESH';
    RETURN;
  END IF;

  SELECT j.status INTO collection_status
  FROM public.collection_jobs j
  WHERE j.request_identity = p_batch_id
  FOR SHARE;
  collection_found := FOUND;
  IF collection_found AND collection_status IN ('PENDING', 'PROCESSING') THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_TERMINAL';
    RETURN;
  END IF;
  IF collection_found AND collection_status = 'FAILED' THEN
    RETURN QUERY SELECT false, 'COLLECTION_FAILED_USE_RECONCILER';
    RETURN;
  END IF;
  IF NOT collection_found AND p_min_age_seconds = 0 THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_PROVEN';
    RETURN;
  END IF;
  IF collection_found AND collection_status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN QUERY SELECT false, 'COLLECTION_NOT_TERMINAL';
    RETURN;
  END IF;

  -- Discovery/enrichment counters are not sends.  Any reservation, ready
  -- item, failure/ambiguity metric, ledger, preparation, attempt, outbox, or
  -- idempotency record makes the state unsafe to auto-terminalize.
  IF greatest(
      coalesce(batch_row.reserved, 0), coalesce(batch_row.ready, 0),
      coalesce(batch_row.sent, 0), coalesce(batch_row.delivered, 0),
      coalesce(batch_row.failed, 0), coalesce(batch_row.ambiguous, 0),
      coalesce(batch_row.hard_bounced, 0), coalesce(batch_row.replies, 0),
      coalesce(batch_row.positive_replies, 0), coalesce(batch_row.opt_outs, 0)
    ) > 0
    OR EXISTS (
      SELECT 1 FROM public.daily6_send_ledger l
      WHERE l.batch_id = p_batch_id
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_runs p
      WHERE p.name = 'daily6:' || p_batch_id
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_manual_message_preparations m
      WHERE m.idempotency_key LIKE p_batch_id || '|%'
         OR EXISTS (
           SELECT 1 FROM public.pilot_runs p
           WHERE p.id = m.pilot_run_id AND p.name = 'daily6:' || p_batch_id
         )
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_manual_email_send_attempts a
      WHERE EXISTS (
        SELECT 1 FROM public.pilot_runs p
        WHERE p.id = a.pilot_run_id AND p.name = 'daily6:' || p_batch_id
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.pilot_manual_email_send_events e
      JOIN public.pilot_manual_email_send_attempts a ON a.id = e.attempt_id
      JOIN public.pilot_runs p ON p.id = a.pilot_run_id
      WHERE p.name = 'daily6:' || p_batch_id
    )
    OR EXISTS (
      SELECT 1 FROM public.campaign_outbox o
      WHERE o.idempotency_key LIKE p_batch_id || '|%'
    )
    OR EXISTS (
      SELECT 1 FROM public.crm_idempotency_keys i
      WHERE i.idempotency_key LIKE p_batch_id || '|%'
    )
    OR EXISTS (
      SELECT 1 FROM public.pilot_idempotency_keys i
      WHERE i.idempotency_key LIKE p_batch_id || '|%'
    )
  THEN
    RETURN QUERY SELECT false, 'SEND_SIDE_EFFECT_PRESENT';
    RETURN;
  END IF;

  UPDATE public.daily6_batches b
  SET status = 'FAILED',
      terminal_reason = p_reason,
      updated_at = clock_timestamp()
  WHERE b.batch_id = p_batch_id
    AND b.status IN ('PENDING', 'RUNNING');
  GET DIAGNOSTICS batch_updated = ROW_COUNT;

  IF batch_updated <> 1 THEN
    RETURN QUERY SELECT false, 'CONCURRENT_STATE_CHANGE';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, p_reason;
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.terminalize_daily6_without_send(text, text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.terminalize_daily6_without_send(text, text, integer)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
