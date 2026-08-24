BEGIN;

-- Migration 0063 introduced a RETURNS TABLE(status, terminal_reason)
-- function. Its UPDATE predicate used an unqualified status, which
-- PostgreSQL resolves as ambiguous between the output column and the table
-- column. Redefine the function incrementally; applied migrations remain
-- immutable and terminal batch semantics stay unchanged.
CREATE OR REPLACE FUNCTION lead_finder_internal.finalize_daily6_batch(
  p_batch_id text,
  p_discovered integer,
  p_enriched integer,
  p_auto_approved integer,
  p_rejected integer,
  p_ready integer,
  p_sent integer,
  p_delivered integer,
  p_failed integer,
  p_ambiguous integer,
  p_terminal_reason text
)
RETURNS TABLE(status text, terminal_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_row public.daily6_batches%ROWTYPE;
  final_status text;
  final_reason text;
  updated_status text;
  updated_reason text;
BEGIN
  IF p_batch_id IS NULL
    OR p_batch_id !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
    OR p_discovered < 0 OR p_enriched < 0 OR p_auto_approved < 0
    OR p_rejected < 0 OR p_ready < 0 OR p_sent < 0 OR p_sent > 2
    OR p_delivered < 0 OR p_failed < 0 OR p_ambiguous < 0
    OR p_terminal_reason IS NULL
    OR p_terminal_reason !~ '^[A-Z0-9_:-]{1,120}$'
  THEN
    RAISE EXCEPTION 'DAILY6_TERMINAL_METRICS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_row
  FROM public.daily6_batches
  WHERE public.daily6_batches.batch_id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY6_BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF current_row.status IN ('COMPLETED', 'FAILED', 'BLOCKED') THEN
    RETURN QUERY SELECT current_row.status, coalesce(current_row.terminal_reason, 'ALREADY_TERMINAL');
    RETURN;
  END IF;

  IF p_ambiguous > 0 OR p_terminal_reason = 'AMBIGUOUS_SEND' THEN
    final_status := 'BLOCKED';
    final_reason := 'AMBIGUOUS_SEND';
  ELSE
    final_status := 'COMPLETED';
    final_reason := p_terminal_reason;
  END IF;

  UPDATE public.daily6_batches
  SET discovered = p_discovered,
      enriched = p_enriched,
      auto_approved = p_auto_approved,
      rejected = p_rejected,
      ready = p_ready,
      sent = p_sent,
      delivered = p_delivered,
      failed = p_failed,
      ambiguous = p_ambiguous,
      status = final_status,
      terminal_reason = final_reason,
      updated_at = clock_timestamp()
  WHERE public.daily6_batches.batch_id = p_batch_id
    AND public.daily6_batches.status IN ('PENDING', 'RUNNING')
  RETURNING public.daily6_batches.status, public.daily6_batches.terminal_reason
  INTO updated_status, updated_reason;

  IF FOUND THEN
    RETURN QUERY SELECT updated_status, updated_reason;
    RETURN;
  ELSE
    SELECT b.status, b.terminal_reason
      INTO updated_status, updated_reason
    FROM public.daily6_batches b
    WHERE b.batch_id = p_batch_id;
  END IF;
  RETURN QUERY SELECT updated_status, coalesce(updated_reason, final_reason);
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_batch(text,integer,integer,integer,integer,integer,integer,integer,integer,integer,text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_batch(text,integer,integer,integer,integer,integer,integer,integer,integer,integer,text)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
