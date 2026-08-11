-- Connect the Daily-6 ledger to first-contact delivery without exposing the
-- ledger through the Supabase Data API. Reservations are conservative: every
-- reservation consumes a batch/day slot, including deterministic failures, so
-- a failed persistence path can never be retried into an over-quota send.
ALTER TABLE public.daily6_batches
  ADD COLUMN IF NOT EXISTS reserved integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily6_batches_reserved_check'
      AND conrelid = 'public.daily6_batches'::regclass
  ) THEN
    ALTER TABLE public.daily6_batches
      ADD CONSTRAINT daily6_batches_reserved_check
      CHECK (reserved >= 0 AND reserved <= max_sends_per_batch);
  END IF;
END $$;

-- Reconcile the new reservation counter from any pre-existing ledger rows.
-- Refuse an already-invalid batch rather than silently truncating or dropping
-- historical quota state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.daily6_batches b
    JOIN (
      SELECT batch_id, count(*)::integer AS reserved
      FROM public.daily6_send_ledger
      GROUP BY batch_id
    ) l ON l.batch_id = b.batch_id
    WHERE l.reserved > b.max_sends_per_batch
  ) THEN
    RAISE EXCEPTION 'DAILY6_EXISTING_LEDGER_EXCEEDS_BATCH_QUOTA' USING ERRCODE = 'check_violation';
  END IF;
END $$;

UPDATE public.daily6_batches b
SET reserved = l.reserved,
    updated_at = now()
FROM (
  SELECT batch_id, count(*)::integer AS reserved
  FROM public.daily6_send_ledger
  GROUP BY batch_id
) l
WHERE l.batch_id = b.batch_id;

CREATE UNIQUE INDEX IF NOT EXISTS daily6_recipient_fingerprint_uidx
  ON public.daily6_send_ledger (recipient_fingerprint);

CREATE SCHEMA IF NOT EXISTS lead_finder_internal;
REVOKE ALL ON SCHEMA lead_finder_internal FROM PUBLIC;

CREATE OR REPLACE FUNCTION lead_finder_internal.reserve_daily6_send(
  p_batch_id text,
  p_send_identity text,
  p_lead_id uuid,
  p_recipient_fingerprint char(64),
  p_policy_version text
)
RETURNS TABLE(reserved boolean, replayed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_row public.daily6_batches%ROWTYPE;
  existing_row public.daily6_send_ledger%ROWTYPE;
  daily_reserved integer;
BEGIN
  IF p_policy_version <> 'daily6-v1'
    OR p_batch_id IS NULL OR length(trim(p_batch_id)) = 0
    OR p_send_identity IS NULL OR length(trim(p_send_identity)) = 0
    OR p_lead_id IS NULL
    OR p_recipient_fingerprint IS NULL
    OR btrim(p_recipient_fingerprint::text) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DAILY6_INVALID_RESERVATION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO batch_row
  FROM public.daily6_batches
  WHERE batch_id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch_row.policy_version <> p_policy_version THEN
    RAISE EXCEPTION 'DAILY6_BATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Serialize all reservations for the same HML day/policy, regardless of
  -- batch slot. The batch row lock alone cannot protect the 09/13/16 total.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'daily6:' || batch_row.batch_date::text || ':' || batch_row.policy_version, 0
  ));

  SELECT * INTO existing_row
  FROM public.daily6_send_ledger
  WHERE send_identity = p_send_identity;
  IF FOUND THEN
    IF existing_row.batch_id = p_batch_id
      AND existing_row.lead_id = p_lead_id
      AND existing_row.recipient_fingerprint = p_recipient_fingerprint THEN
      RETURN QUERY SELECT false, true, 'REPLAYED';
      RETURN;
    END IF;
    RAISE EXCEPTION 'DAILY6_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.daily6_send_ledger
    WHERE recipient_fingerprint = p_recipient_fingerprint
  ) THEN
    RAISE EXCEPTION 'DAILY6_RECIPIENT_ALREADY_RESERVED' USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer INTO daily_reserved
  FROM public.daily6_send_ledger l
  JOIN public.daily6_batches b ON b.batch_id = l.batch_id
  WHERE b.batch_date = batch_row.batch_date
    AND b.policy_version = batch_row.policy_version;

  IF batch_row.reserved >= batch_row.max_sends_per_batch THEN
    RAISE EXCEPTION 'DAILY6_BATCH_QUOTA_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;
  IF daily_reserved >= batch_row.max_sends_per_day THEN
    RAISE EXCEPTION 'DAILY6_DAILY_QUOTA_EXCEEDED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.daily6_send_ledger(
    batch_id, send_identity, lead_id, recipient_fingerprint, status
  ) VALUES (
    p_batch_id, p_send_identity, p_lead_id, p_recipient_fingerprint, 'RESERVED'
  );
  UPDATE public.daily6_batches
  SET reserved = reserved + 1, updated_at = now(), status = 'RUNNING'
  WHERE batch_id = p_batch_id;
  RETURN QUERY SELECT true, false, 'RESERVED';
END;
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.finalize_daily6_send(
  p_batch_id text,
  p_send_identity text,
  p_status text,
  p_provider_message_fingerprint char(64),
  p_error_code text
)
RETURNS TABLE(updated boolean, replayed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  ledger_row public.daily6_send_ledger%ROWTYPE;
BEGIN
  IF p_status NOT IN ('SENT', 'FAILED', 'AMBIGUOUS') THEN
    RAISE EXCEPTION 'DAILY6_INVALID_TERMINAL_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_provider_message_fingerprint IS NOT NULL
    AND btrim(p_provider_message_fingerprint::text) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DAILY6_INVALID_PROVIDER_FINGERPRINT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('daily6:send:' || p_send_identity, 0));
  SELECT * INTO ledger_row
  FROM public.daily6_send_ledger
  WHERE batch_id = p_batch_id AND send_identity = p_send_identity
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY6_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF ledger_row.status = p_status
    AND ledger_row.provider_message_fingerprint IS NOT DISTINCT FROM p_provider_message_fingerprint THEN
    RETURN QUERY SELECT false, true, 'REPLAYED';
    RETURN;
  END IF;
  IF ledger_row.status <> 'RESERVED' THEN
    RAISE EXCEPTION 'DAILY6_TERMINAL_CONFLICT' USING ERRCODE = '55000';
  END IF;

  UPDATE public.daily6_send_ledger
  SET status = p_status,
      provider_message_fingerprint = p_provider_message_fingerprint,
      updated_at = now()
  WHERE id = ledger_row.id;
  UPDATE public.daily6_batches
  SET sent = sent + CASE WHEN p_status = 'SENT' THEN 1 ELSE 0 END,
      failed = failed + CASE WHEN p_status = 'FAILED' THEN 1 ELSE 0 END,
      ambiguous = ambiguous + CASE WHEN p_status = 'AMBIGUOUS' THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE batch_id = p_batch_id;
  RETURN QUERY SELECT true, false, p_status;
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.reserve_daily6_send(text, text, uuid, char(64), text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_send(text, text, text, char(64), text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.reserve_daily6_send(text, text, uuid, char(64), text) TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_send(text, text, text, char(64), text) TO lead_finder_api_runtime;
  END IF;
END $$;
