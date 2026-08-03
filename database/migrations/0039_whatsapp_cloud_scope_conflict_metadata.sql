BEGIN;

-- Preserve the append-only HML scope guard while exposing its domain identity
-- to the application. Unknown 23505 errors remain distinguishable and are not
-- converted into a retryable or user-facing conflict.
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
      RAISE EXCEPTION 'whatsapp cloud send limit reached'
        USING ERRCODE = '23505',
              CONSTRAINT = 'pilot_manual_whatsapp_cloud_send_attempts_send_scope_key';
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

COMMIT;
