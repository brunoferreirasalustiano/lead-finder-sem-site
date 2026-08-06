BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_manual_email_contact_context(
  p_pilot_run_id uuid,
  p_lead_id uuid,
  p_contact_id uuid,
  p_operator_principal_id text
)
RETURNS TABLE(
  contact_fingerprint char(64),
  contact_source text,
  lead_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'manual email principal is invalid' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT resolved.contact_fingerprint,
         resolved.contact_source,
         resolved.lead_name
  FROM public.resolve_narrow_contact(
    p_pilot_run_id,
    p_lead_id,
    p_contact_id,
    'EMAIL',
    p_operator_principal_id,
    'MANUAL_MESSAGE_PREPARE',
    'B2B_PROSPECTION'
  ) resolved;
END
$$;

CREATE OR REPLACE FUNCTION public.create_manual_email_preparation(
  p_pilot_run_id uuid,
  p_lead_id uuid,
  p_contact_id uuid,
  p_template_id text,
  p_template_version text,
  p_operator_principal_id text,
  p_payload_fingerprint char(64),
  p_idempotency_key text,
  p_result_fingerprint char(64),
  p_result_snapshot jsonb
)
RETURNS TABLE(
  id uuid,
  prepared_at timestamptz,
  expires_at timestamptz,
  result_fingerprint char(64),
  result_snapshot jsonb,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  existing public.pilot_manual_message_preparations%ROWTYPE;
  resolved record;
  inserted public.pilot_manual_message_preparations%ROWTYPE;
BEGIN
  IF p_template_id <> 'pilot-email-first-contact'
    OR p_template_version NOT IN ('v1','v2')
    OR p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
    OR p_payload_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_result_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_idempotency_key IS NULL
    OR char_length(p_idempotency_key) NOT BETWEEN 16 AND 128
    OR p_result_snapshot IS NULL
    OR jsonb_typeof(p_result_snapshot) <> 'object'
  THEN
    RAISE EXCEPTION 'manual email preparation input is invalid' USING ERRCODE='22023';
  END IF;

  IF p_result_snapshot->>'channel' <> 'EMAIL'
    OR p_result_snapshot->>'templateId' <> p_template_id
    OR p_result_snapshot->>'templateVersion' <> p_template_version
    OR coalesce(p_result_snapshot->>'contactFingerprint','') !~ '^[0-9a-f]{64}$'
    OR coalesce(p_result_snapshot->>'messageFingerprint','') !~ '^[0-9a-f]{64}$'
    OR coalesce(p_result_snapshot->>'renderedInputsFingerprint','') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'manual email preparation snapshot is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-email-preparation:' || p_pilot_run_id::text || ':' || p_idempotency_key,
    0
  ));

  SELECT * INTO resolved
  FROM public.resolve_narrow_contact(
    p_pilot_run_id,
    p_lead_id,
    p_contact_id,
    'EMAIL',
    p_operator_principal_id,
    'MANUAL_MESSAGE_PREPARE',
    'B2B_PROSPECTION'
  );

  IF resolved.contact_fingerprint::text <> p_result_snapshot->>'contactFingerprint' THEN
    RAISE EXCEPTION 'manual email contact fingerprint changed' USING ERRCODE='55000';
  END IF;

  SELECT * INTO existing
  FROM public.pilot_manual_message_preparations preparation
  WHERE preparation.pilot_run_id=p_pilot_run_id
    AND preparation.idempotency_key=p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing.operator_principal_id <> p_operator_principal_id
      OR existing.lead_id <> p_lead_id
      OR existing.contact_id <> p_contact_id
      OR existing.channel <> 'EMAIL'
      OR existing.template_id <> p_template_id
      OR existing.template_version <> p_template_version
      OR existing.payload_fingerprint::text <> p_payload_fingerprint::text
      OR existing.result_fingerprint::text <> p_result_fingerprint::text
      OR existing.result_snapshot <> p_result_snapshot
    THEN
      RAISE EXCEPTION 'manual email idempotency conflict' USING ERRCODE='23505';
    END IF;
    IF existing.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'manual email preparation expired' USING ERRCODE='55000';
    END IF;
    RETURN QUERY SELECT existing.id,existing.prepared_at,existing.expires_at,
      existing.result_fingerprint,existing.result_snapshot,true;
    RETURN;
  END IF;

  IF p_template_version <> 'v2' THEN
    RAISE EXCEPTION 'new manual email preparations require template v2' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.pilot_manual_message_preparations(
    pilot_run_id,lead_id,contact_id,channel,template_id,template_version,
    operator_principal_id,payload_fingerprint,idempotency_key,
    result_fingerprint,result_snapshot,expires_at
  ) VALUES (
    p_pilot_run_id,p_lead_id,p_contact_id,'EMAIL',p_template_id,p_template_version,
    p_operator_principal_id,p_payload_fingerprint,p_idempotency_key,
    p_result_fingerprint,p_result_snapshot,clock_timestamp()+interval '24 hours'
  )
  RETURNING * INTO inserted;

  RETURN QUERY SELECT inserted.id,inserted.prepared_at,inserted.expires_at,
    inserted.result_fingerprint,inserted.result_snapshot,false;
END
$$;

CREATE OR REPLACE FUNCTION public.resolve_manual_email_preparation_context(
  p_preparation_id uuid,
  p_operator_principal_id text,
  p_require_open boolean
)
RETURNS TABLE(
  pilot_run_id uuid,
  lead_id uuid,
  contact_id uuid,
  template_id text,
  template_version text,
  result_fingerprint char(64),
  result_snapshot jsonb,
  contact_value text,
  contact_fingerprint char(64),
  contact_source text,
  lead_name text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  preparation public.pilot_manual_message_preparations%ROWTYPE;
  resolved record;
BEGIN
  IF p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'manual email principal is invalid' USING ERRCODE='22023';
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
  IF preparation.operator_principal_id <> p_operator_principal_id THEN
    RAISE EXCEPTION 'manual email preparation principal mismatch' USING ERRCODE='42501';
  END IF;
  IF preparation.channel <> 'EMAIL' THEN
    RAISE EXCEPTION 'preparation is not email' USING ERRCODE='42809';
  END IF;
  IF preparation.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'manual email preparation expired' USING ERRCODE='55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pilot_manual_message_events event
    WHERE event.preparation_id=p_preparation_id
      AND event.event_type IN ('CANCELLED','CONTACT_CONFIRMED','RESPONSE_RECORDED')
  ) THEN
    RAISE EXCEPTION 'manual email preparation is terminal' USING ERRCODE='55000';
  END IF;
  IF p_require_open AND NOT EXISTS (
    SELECT 1 FROM public.pilot_manual_message_events event
    WHERE event.preparation_id=p_preparation_id AND event.event_type='OPENED'
  ) THEN
    RAISE EXCEPTION 'manual email preparation must be opened' USING ERRCODE='55000';
  END IF;

  SELECT * INTO resolved
  FROM public.resolve_narrow_contact(
    preparation.pilot_run_id,
    preparation.lead_id,
    preparation.contact_id,
    'EMAIL',
    p_operator_principal_id,
    'MANUAL_MESSAGE_OPEN',
    'B2B_PROSPECTION'
  );

  IF resolved.contact_fingerprint::text <> preparation.result_snapshot->>'contactFingerprint' THEN
    RAISE EXCEPTION 'manual email contact fingerprint changed' USING ERRCODE='55000';
  END IF;

  RETURN QUERY SELECT preparation.pilot_run_id,preparation.lead_id,preparation.contact_id,
    preparation.template_id,preparation.template_version,preparation.result_fingerprint,
    preparation.result_snapshot,resolved.contact_value,resolved.contact_fingerprint,
    resolved.contact_source,resolved.lead_name,preparation.expires_at;
END
$$;

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
  existing public.pilot_manual_message_events%ROWTYPE;
  inserted public.pilot_manual_message_events%ROWTYPE;
BEGIN
  IF p_payload_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_idempotency_key IS NULL
    OR char_length(p_idempotency_key) NOT BETWEEN 16 AND 128
  THEN
    RAISE EXCEPTION 'manual email open input is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,false
  );

  SELECT * INTO existing
  FROM public.pilot_manual_message_events event
  WHERE event.preparation_id=p_preparation_id AND event.event_type='OPENED'
  FOR UPDATE;

  IF FOUND THEN
    IF existing.operator_principal_id <> p_operator_principal_id
      OR existing.payload_fingerprint::text <> p_payload_fingerprint::text
      OR existing.idempotency_key <> p_idempotency_key
    THEN
      RAISE EXCEPTION 'manual email open idempotency conflict' USING ERRCODE='23505';
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

  RETURN QUERY SELECT inserted.id,inserted.created_at,false;
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
  IF p_sender_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_recipient_fingerprint::text !~ '^[0-9a-f]{64}$'
    OR p_message_fingerprint::text !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'manual email attempt fingerprints are invalid' USING ERRCODE='22023';
  END IF;

  SELECT * INTO context_record
  FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,true
  );

  IF context_record.result_snapshot->>'messageFingerprint' <> p_message_fingerprint::text THEN
    RAISE EXCEPTION 'manual email message fingerprint changed' USING ERRCODE='55000';
  END IF;

  SELECT * INTO existing_attempt
  FROM public.pilot_manual_email_send_attempts attempt
  WHERE attempt.preparation_id=p_preparation_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.operator_principal_id <> p_operator_principal_id
      OR existing_attempt.sender_fingerprint::text <> p_sender_fingerprint::text
      OR existing_attempt.recipient_fingerprint::text <> p_recipient_fingerprint::text
      OR existing_attempt.message_fingerprint::text <> p_message_fingerprint::text
      OR existing_attempt.provider <> 'GMAIL_API'
    THEN
      RAISE EXCEPTION 'manual email attempt conflict' USING ERRCODE='23505';
    END IF;
    SELECT * INTO existing_event
    FROM public.pilot_manual_email_send_events event
    WHERE event.attempt_id=existing_attempt.id;
    RETURN QUERY SELECT existing_attempt.id,existing_attempt.reserved_at,true,
      existing_event.event_type,existing_event.provider_message_fingerprint,
      existing_event.error_code,existing_event.created_at;
    RETURN;
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

CREATE OR REPLACE FUNCTION public.append_manual_email_send_event(
  p_attempt_id uuid,
  p_operator_principal_id text,
  p_event_type text,
  p_provider_message_fingerprint char(64),
  p_error_code text
)
RETURNS TABLE(
  id uuid,
  event_type text,
  provider_message_fingerprint char(64),
  error_code text,
  created_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  attempt_record public.pilot_manual_email_send_attempts%ROWTYPE;
  existing public.pilot_manual_email_send_events%ROWTYPE;
  inserted public.pilot_manual_email_send_events%ROWTYPE;
BEGIN
  IF p_event_type NOT IN ('DELIVERED','FAILED','AMBIGUOUS')
    OR (p_event_type='DELIVERED' AND (
      p_provider_message_fingerprint IS NULL
      OR p_provider_message_fingerprint::text !~ '^[0-9a-f]{64}$'
      OR p_error_code IS NOT NULL
    ))
    OR (p_event_type IN ('FAILED','AMBIGUOUS') AND (
      p_provider_message_fingerprint IS NOT NULL
      OR p_error_code IS NULL
      OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,99}$'
    ))
  THEN
    RAISE EXCEPTION 'manual email terminal event is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-email-attempt:' || p_attempt_id::text,
    0
  ));

  SELECT * INTO attempt_record
  FROM public.pilot_manual_email_send_attempts attempt
  WHERE attempt.id=p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual email attempt not found' USING ERRCODE='P0002';
  END IF;
  IF attempt_record.operator_principal_id <> p_operator_principal_id THEN
    RAISE EXCEPTION 'manual email attempt principal mismatch' USING ERRCODE='42501';
  END IF;

  SELECT * INTO existing
  FROM public.pilot_manual_email_send_events event
  WHERE event.attempt_id=p_attempt_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing.event_type <> p_event_type
      OR existing.provider_message_fingerprint IS DISTINCT FROM p_provider_message_fingerprint
      OR existing.error_code IS DISTINCT FROM p_error_code
    THEN
      RAISE EXCEPTION 'manual email terminal event conflict' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT existing.id,existing.event_type,
      existing.provider_message_fingerprint,existing.error_code,
      existing.created_at,true;
    RETURN;
  END IF;

  INSERT INTO public.pilot_manual_email_send_events(
    attempt_id,event_type,provider_message_fingerprint,error_code
  ) VALUES (
    p_attempt_id,p_event_type,p_provider_message_fingerprint,p_error_code
  ) RETURNING * INTO inserted;

  RETURN QUERY SELECT inserted.id,inserted.event_type,
    inserted.provider_message_fingerprint,inserted.error_code,
    inserted.created_at,false;
END
$$;

REVOKE ALL ON FUNCTION public.resolve_manual_email_contact_context(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,character,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,character,character,character) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_email_send_event(uuid,text,text,character,text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_contact_context(uuid,uuid,uuid,text) FROM anon;
    REVOKE ALL ON FUNCTION public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean) FROM anon;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,character,text) FROM anon;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,character,character,character) FROM anon;
    REVOKE ALL ON FUNCTION public.append_manual_email_send_event(uuid,text,text,character,text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_contact_context(uuid,uuid,uuid,text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean) FROM authenticated;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,character,text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,character,character,character) FROM authenticated;
    REVOKE ALL ON FUNCTION public.append_manual_email_send_event(uuid,text,text,character,text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_contact_context(uuid,uuid,uuid,text) FROM service_role;
    REVOKE ALL ON FUNCTION public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb) FROM service_role;
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean) FROM service_role;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,character,text) FROM service_role;
    REVOKE ALL ON FUNCTION public.create_manual_email_send_attempt(uuid,text,character,character,character) FROM service_role;
    REVOKE ALL ON FUNCTION public.append_manual_email_send_event(uuid,text,text,character,text) FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION
      public.resolve_manual_email_contact_context(uuid,uuid,uuid,text),
      public.create_manual_email_preparation(uuid,uuid,uuid,text,text,text,character,text,character,jsonb),
      public.resolve_manual_email_preparation_context(uuid,text,boolean),
      public.append_manual_email_open_event(uuid,text,character,text),
      public.create_manual_email_send_attempt(uuid,text,character,character,character),
      public.append_manual_email_send_event(uuid,text,text,character,text)
    TO lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
