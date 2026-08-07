BEGIN;

-- The first OPENED transition is inserted before live-state validation so that
-- PostgreSQL remains the authority for the historical fact.  If the live
-- validation fails, the surrounding statement rolls the insert back; a later
-- retry can therefore not replay an invalid first open.  Once committed, a
-- retry is handled by the existing event lookup before any live gates.
CREATE OR REPLACE FUNCTION public.append_manual_email_open_event(
  p_preparation_id uuid,
  p_operator_principal_id text,
  p_payload_fingerprint char(64),
  p_idempotency_key text
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  preparation public.pilot_manual_message_preparations%ROWTYPE;
  existing public.pilot_manual_message_events%ROWTYPE;
  inserted public.pilot_manual_message_events%ROWTYPE;
BEGIN
  IF p_preparation_id IS NULL
    OR p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
    OR p_payload_fingerprint IS NULL
    OR p_payload_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_idempotency_key IS NULL
    OR char_length(p_idempotency_key) NOT BETWEEN 16 AND 128
  THEN
    RAISE EXCEPTION 'manual email open input is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-email-preparation:' || p_preparation_id::text,
    0
  ));

  SELECT * INTO preparation
  FROM public.pilot_manual_message_preparations item
  WHERE item.id=p_preparation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual email preparation not found' USING ERRCODE='P0002';
  END IF;
  IF preparation.operator_principal_id IS DISTINCT FROM p_operator_principal_id THEN
    RAISE EXCEPTION 'manual email open principal mismatch' USING ERRCODE='42501';
  END IF;
  IF preparation.channel IS DISTINCT FROM 'EMAIL' THEN
    RAISE EXCEPTION 'preparation is not email' USING ERRCODE='42809';
  END IF;

  SELECT * INTO existing
  FROM public.pilot_manual_message_events event
  WHERE event.preparation_id=p_preparation_id AND event.event_type='OPENED'
  FOR UPDATE;

  IF FOUND THEN
    IF existing.operator_principal_id IS DISTINCT FROM p_operator_principal_id THEN
      RAISE EXCEPTION 'manual email open principal mismatch' USING ERRCODE='42501';
    END IF;
    RETURN QUERY SELECT existing.id,existing.created_at,true;
    RETURN;
  END IF;

  INSERT INTO public.pilot_manual_message_events(
    preparation_id,event_type,result,operator_principal_id,observation,
    payload_fingerprint,idempotency_key
  ) VALUES (
    p_preparation_id,'OPENED',NULL,p_operator_principal_id,NULL,
    p_payload_fingerprint,p_idempotency_key
  ) RETURNING * INTO inserted;

  -- Require an OPENED event while validating the first transition.  The
  -- function's statement-level rollback removes the provisional row if any
  -- expiry, pilot, eligibility, or snapshot gate rejects the transition.
  PERFORM 1 FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,true
  );

  RETURN QUERY SELECT inserted.id,inserted.created_at,false;
END
$$;

REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
