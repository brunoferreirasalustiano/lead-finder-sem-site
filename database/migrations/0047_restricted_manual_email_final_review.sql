BEGIN;

-- An observer must never terminalize an unresolved send attempt merely because
-- a fixed lease timestamp elapsed. The original sender can still be inside the
-- provider call or persisting its terminal result. Keep PostgreSQL authoritative
-- for persisted outcomes and fail closed as IN_PROGRESS until the owner writes a
-- terminal event (or a future explicit reconciliation protocol fences ownership).
CREATE OR REPLACE FUNCTION public.get_manual_email_send_attempt(
  p_preparation_id uuid,
  p_operator_principal_id text
)
RETURNS TABLE(
  id uuid,
  reserved_at timestamptz,
  replayed boolean,
  event_type text,
  provider_message_fingerprint char(64),
  error_code text,
  event_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  existing_attempt public.pilot_manual_email_send_attempts%ROWTYPE;
  existing_event public.pilot_manual_email_send_events%ROWTYPE;
BEGIN
  IF p_preparation_id IS NULL
    OR p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'manual email principal is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-email-attempt-preparation:' || p_preparation_id::text,
    0
  ));

  SELECT * INTO existing_attempt
  FROM public.pilot_manual_email_send_attempts attempt
  WHERE attempt.preparation_id=p_preparation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF existing_attempt.operator_principal_id IS DISTINCT FROM p_operator_principal_id THEN
    RAISE EXCEPTION 'manual email attempt principal mismatch' USING ERRCODE='42501';
  END IF;

  SELECT * INTO existing_event
  FROM public.pilot_manual_email_send_events event
  WHERE event.attempt_id=existing_attempt.id
  FOR UPDATE;

  RETURN QUERY SELECT existing_attempt.id,existing_attempt.reserved_at,true,
    existing_event.event_type,existing_event.provider_message_fingerprint,
    existing_event.error_code,existing_event.created_at;
END
$$;

CREATE OR REPLACE FUNCTION public.create_manual_email_send_attempt(
  p_preparation_id uuid,
  p_operator_principal_id text,
  p_sender_fingerprint char(64),
  p_recipient_fingerprint char(64),
  p_message_fingerprint char(64)
)
RETURNS TABLE(
  id uuid,
  reserved_at timestamptz,
  replayed boolean,
  event_type text,
  provider_message_fingerprint char(64),
  error_code text,
  event_created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  context_record record;
  existing_attempt public.pilot_manual_email_send_attempts%ROWTYPE;
  existing_event public.pilot_manual_email_send_events%ROWTYPE;
  inserted public.pilot_manual_email_send_attempts%ROWTYPE;
BEGIN
  IF p_preparation_id IS NULL
    OR p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
    OR p_sender_fingerprint IS NULL
    OR p_sender_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_recipient_fingerprint IS NULL
    OR p_recipient_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_message_fingerprint IS NULL
    OR p_message_fingerprint::text !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'manual email attempt input is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-email-attempt-preparation:' || p_preparation_id::text,
    0
  ));

  SELECT * INTO existing_attempt
  FROM public.pilot_manual_email_send_attempts attempt
  WHERE attempt.preparation_id=p_preparation_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.operator_principal_id IS DISTINCT FROM p_operator_principal_id
      OR existing_attempt.sender_fingerprint::text IS DISTINCT FROM p_sender_fingerprint::text
      OR existing_attempt.recipient_fingerprint::text IS DISTINCT FROM p_recipient_fingerprint::text
      OR existing_attempt.message_fingerprint::text IS DISTINCT FROM p_message_fingerprint::text
      OR existing_attempt.provider IS DISTINCT FROM 'GMAIL_API'
    THEN
      RAISE EXCEPTION 'manual email attempt conflict' USING ERRCODE='23505';
    END IF;

    SELECT * INTO existing_event
    FROM public.pilot_manual_email_send_events event
    WHERE event.attempt_id=existing_attempt.id
    FOR UPDATE;

    RETURN QUERY SELECT existing_attempt.id,existing_attempt.reserved_at,true,
      existing_event.event_type,existing_event.provider_message_fingerprint,
      existing_event.error_code,existing_event.created_at;
    RETURN;
  END IF;

  SELECT * INTO context_record
  FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,true
  );

  IF context_record.result_snapshot->>'messageFingerprint' IS DISTINCT FROM p_message_fingerprint::text THEN
    RAISE EXCEPTION 'manual email message fingerprint changed' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.pilot_manual_email_send_attempts(
    preparation_id,pilot_run_id,lead_id,contact_id,operator_principal_id,
    sender_fingerprint,recipient_fingerprint,message_fingerprint,provider
  ) VALUES (
    p_preparation_id,context_record.pilot_run_id,context_record.lead_id,
    context_record.contact_id,p_operator_principal_id,p_sender_fingerprint,
    p_recipient_fingerprint,p_message_fingerprint,'GMAIL_API'
  ) RETURNING * INTO inserted;

  RETURN QUERY SELECT inserted.id,inserted.reserved_at,false,
    NULL::text,NULL::char(64),NULL::text,NULL::timestamptz;
END
$$;

-- Use the same lifecycle advisory lock and order as legacy event transitions:
-- lifecycle lock -> restricted-email lock -> preparation row lock. This avoids
-- deadlocks when restricted OPENED races cancellation/confirmation paths.
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
    'manual-message-preparation:' || p_preparation_id::text,
    0
  ));
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

  PERFORM 1 FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,true
  );

  RETURN QUERY SELECT inserted.id,inserted.created_at,false;
END
$$;

REVOKE ALL ON FUNCTION public.get_manual_email_send_attempt(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,char(64),char(64),char(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.get_manual_email_send_attempt(uuid,text) FROM anon;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,char(64),char(64),char(64)) FROM anon;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.get_manual_email_send_attempt(uuid,text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,char(64),char(64),char(64)) FROM authenticated;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.get_manual_email_send_attempt(uuid,text) FROM service_role;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,char(64),char(64),char(64)) FROM service_role;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text) FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON FUNCTION public.get_manual_email_send_attempt(uuid,text) FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,char(64),char(64),char(64)) FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text) FROM lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
