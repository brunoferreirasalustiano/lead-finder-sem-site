BEGIN;

-- Migration 0035 defined RETURNS TABLE columns named `id`. PostgreSQL treats
-- those output names as PL/pgSQL variables, so an unqualified RETURNING id is
-- ambiguous at runtime. Keep the public function signatures stable while
-- qualifying the returned table columns.
CREATE OR REPLACE FUNCTION public.create_manual_whatsapp_cloud_send_attempt(
  p_preparation_id uuid,
  p_pilot_run_id uuid,
  p_lead_id uuid,
  p_contact_id uuid,
  p_send_scope text,
  p_operator_principal_id text,
  p_phone_number_id_fingerprint char(64),
  p_recipient_fingerprint char(64),
  p_message_fingerprint char(64),
  p_payload_fingerprint char(64),
  p_idempotency_fingerprint char(64)
)
RETURNS TABLE(
  id uuid,
  reserved_at timestamptz,
  replayed boolean,
  event_type text,
  provider_message_fingerprint char(64),
  error_code text,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior public.pilot_manual_whatsapp_cloud_send_attempts%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-cloud-send:' || p_preparation_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-cloud-scope:' || p_send_scope, 0));

  SELECT * INTO prior
  FROM public.pilot_manual_whatsapp_cloud_send_attempts
  WHERE preparation_id = p_preparation_id OR send_scope = p_send_scope;

  IF prior.id IS NOT NULL THEN
    IF prior.preparation_id <> p_preparation_id OR prior.send_scope <> p_send_scope THEN
      RAISE EXCEPTION 'whatsapp cloud send limit reached' USING ERRCODE = '23505';
    END IF;
    IF prior.pilot_run_id <> p_pilot_run_id
      OR prior.lead_id <> p_lead_id
      OR prior.contact_id <> p_contact_id
      OR prior.operator_principal_id <> p_operator_principal_id
      OR prior.phone_number_id_fingerprint <> p_phone_number_id_fingerprint
      OR prior.recipient_fingerprint <> p_recipient_fingerprint
      OR prior.message_fingerprint <> p_message_fingerprint
      OR prior.payload_fingerprint <> p_payload_fingerprint
      OR prior.idempotency_fingerprint <> p_idempotency_fingerprint THEN
      RAISE EXCEPTION 'whatsapp cloud send idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY
      SELECT prior.id, prior.reserved_at, true,
        event.event_type, event.provider_message_fingerprint,
        event.error_code, event.created_at
      FROM (SELECT 1) AS one
      LEFT JOIN public.pilot_manual_whatsapp_cloud_send_events event
        ON event.attempt_id = prior.id;
    RETURN;
  END IF;

  RETURN QUERY
    INSERT INTO public.pilot_manual_whatsapp_cloud_send_attempts(
      preparation_id, pilot_run_id, lead_id, contact_id,
      operator_principal_id, phone_number_id_fingerprint,
      recipient_fingerprint, message_fingerprint,
      payload_fingerprint, idempotency_fingerprint, provider, send_scope
    ) VALUES (
      p_preparation_id, p_pilot_run_id, p_lead_id, p_contact_id,
      p_operator_principal_id, p_phone_number_id_fingerprint,
      p_recipient_fingerprint, p_message_fingerprint,
      p_payload_fingerprint, p_idempotency_fingerprint, 'WHATSAPP_CLOUD_API', p_send_scope
    )
    RETURNING public.pilot_manual_whatsapp_cloud_send_attempts.id,
      public.pilot_manual_whatsapp_cloud_send_attempts.reserved_at,
      false, NULL::text, NULL::char(64), NULL::text, NULL::timestamptz;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_manual_whatsapp_cloud_send_event(
  p_attempt_id uuid,
  p_event_type text,
  p_provider_message_fingerprint char(64),
  p_error_code text
)
RETURNS TABLE(id uuid, created_at timestamptz, event_type text, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior public.pilot_manual_whatsapp_cloud_send_events%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-cloud-event:' || p_attempt_id::text, 0));
  SELECT * INTO prior
  FROM public.pilot_manual_whatsapp_cloud_send_events
  WHERE attempt_id = p_attempt_id;
  IF prior.id IS NOT NULL THEN
    IF prior.event_type <> p_event_type
      OR prior.provider_message_fingerprint IS DISTINCT FROM p_provider_message_fingerprint
      OR prior.error_code IS DISTINCT FROM p_error_code THEN
      RAISE EXCEPTION 'whatsapp cloud send event conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT prior.id, prior.created_at, prior.event_type, true;
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO public.pilot_manual_whatsapp_cloud_send_events(
      attempt_id, event_type, provider_message_fingerprint, error_code
    ) VALUES (p_attempt_id, p_event_type, p_provider_message_fingerprint, p_error_code)
    RETURNING public.pilot_manual_whatsapp_cloud_send_events.id,
      public.pilot_manual_whatsapp_cloud_send_events.created_at,
      public.pilot_manual_whatsapp_cloud_send_events.event_type, false;
END;
$$;

COMMIT;
