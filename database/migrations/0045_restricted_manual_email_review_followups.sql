BEGIN;

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
  legacy_contact_fingerprint text;
  effective_contact_fingerprint char(64);
  replay_contact_value text;
  replay_contact_source text;
  replay_lead_name text;
BEGIN
  IF p_preparation_id IS NULL
    OR p_operator_principal_id IS NULL
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
  IF preparation.operator_principal_id IS DISTINCT FROM p_operator_principal_id THEN
    RAISE EXCEPTION 'manual email preparation principal mismatch' USING ERRCODE='42501';
  END IF;
  IF preparation.channel IS DISTINCT FROM 'EMAIL' THEN
    RAISE EXCEPTION 'preparation is not email' USING ERRCODE='42809';
  END IF;

  -- OPENED is append-only historical state. A retry must be able to recover the
  -- persisted transition even after the preparation expires or current contact
  -- eligibility changes. Only static ownership/channel identity is rechecked.
  IF NOT p_require_open AND EXISTS (
    SELECT 1 FROM public.pilot_manual_message_events event
    WHERE event.preparation_id=p_preparation_id AND event.event_type='OPENED'
  ) THEN
    SELECT contact.normalized_value,contact.source,coalesce(lead.name,'empresa')
    INTO replay_contact_value,replay_contact_source,replay_lead_name
    FROM public.lead_contacts contact
    JOIN public.leads lead ON lead.id=contact.lead_id
    WHERE contact.id=preparation.contact_id
      AND contact.lead_id=preparation.lead_id;

    IF replay_contact_value IS NULL OR replay_contact_source IS NULL OR replay_lead_name IS NULL THEN
      RAISE EXCEPTION 'manual email preparation context is missing' USING ERRCODE='P0002';
    END IF;

    effective_contact_fingerprint :=
      (preparation.result_snapshot->>'contactFingerprint')::char(64);

    RETURN QUERY SELECT preparation.pilot_run_id,preparation.lead_id,preparation.contact_id,
      preparation.template_id,preparation.template_version,preparation.result_fingerprint,
      preparation.result_snapshot,replay_contact_value,effective_contact_fingerprint,
      replay_contact_source,replay_lead_name,preparation.expires_at;
    RETURN;
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

  IF preparation.template_version = 'v1' THEN
    SELECT pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.format(
            '{"channel":%s,"contactId":%s,"value":%s}',
            pg_catalog.to_json(upper(contact.type))::text,
            pg_catalog.to_json(contact.id::text)::text,
            pg_catalog.to_json(contact.normalized_value)::text
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    INTO legacy_contact_fingerprint
    FROM public.lead_contacts contact
    WHERE contact.id=preparation.contact_id
      AND contact.lead_id=preparation.lead_id;

    IF legacy_contact_fingerprint IS NULL
      OR (
        preparation.result_snapshot->>'contactFingerprint'
          IS DISTINCT FROM resolved.contact_fingerprint::text
        AND preparation.result_snapshot->>'contactFingerprint'
          IS DISTINCT FROM legacy_contact_fingerprint
      )
    THEN
      RAISE EXCEPTION 'manual email contact fingerprint changed' USING ERRCODE='55000';
    END IF;

    effective_contact_fingerprint :=
      (preparation.result_snapshot->>'contactFingerprint')::char(64);
  ELSE
    IF resolved.contact_fingerprint::text
      IS DISTINCT FROM preparation.result_snapshot->>'contactFingerprint'
    THEN
      RAISE EXCEPTION 'manual email contact fingerprint changed' USING ERRCODE='55000';
    END IF;
    effective_contact_fingerprint := resolved.contact_fingerprint;
  END IF;

  RETURN QUERY SELECT preparation.pilot_run_id,preparation.lead_id,preparation.contact_id,
    preparation.template_id,preparation.template_version,preparation.result_fingerprint,
    preparation.result_snapshot,resolved.contact_value,effective_contact_fingerprint,
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

  PERFORM 1 FROM public.resolve_manual_email_preparation_context(
    p_preparation_id,p_operator_principal_id,false
  );

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

REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean)
      FROM anon;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean)
      FROM authenticated;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.resolve_manual_email_preparation_context(uuid,text,boolean)
      FROM service_role;
    REVOKE ALL ON FUNCTION public.append_manual_email_open_event(uuid,text,char(64),text)
      FROM service_role;
  END IF;
END $$;

COMMIT;
