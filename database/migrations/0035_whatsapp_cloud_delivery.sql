BEGIN;

-- The Cloud API path is intentionally isolated from the manual-message event
-- state. A provider acceptance is not SENT_CONFIRMED: delivery confirmation
-- remains a separate human-controlled operation.
CREATE TABLE IF NOT EXISTS public.pilot_manual_whatsapp_cloud_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES public.pilot_manual_message_preparations(id),
  pilot_run_id uuid NOT NULL REFERENCES public.pilot_runs(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  contact_id uuid NOT NULL REFERENCES public.lead_contacts(id),
  operator_principal_id text NOT NULL CHECK (btrim(operator_principal_id) <> ''),
  phone_number_id_fingerprint char(64) NOT NULL CHECK (phone_number_id_fingerprint ~ '^[0-9a-f]{64}$'),
  recipient_fingerprint char(64) NOT NULL CHECK (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  message_fingerprint char(64) NOT NULL CHECK (message_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_fingerprint char(64) NOT NULL CHECK (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider = 'WHATSAPP_CLOUD_API'),
  send_scope text NOT NULL DEFAULT 'HML_TEST' CHECK (send_scope = 'HML_TEST'),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preparation_id),
  UNIQUE (send_scope)
);

CREATE TABLE IF NOT EXISTS public.pilot_manual_whatsapp_cloud_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.pilot_manual_whatsapp_cloud_send_attempts(id),
  event_type text NOT NULL CHECK (event_type IN ('ACCEPTED','FAILED','AMBIGUOUS')),
  provider_message_fingerprint char(64) CHECK (provider_message_fingerprint IS NULL OR provider_message_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id)
);

REVOKE ALL ON public.pilot_manual_whatsapp_cloud_send_attempts,
  public.pilot_manual_whatsapp_cloud_send_events FROM PUBLIC;
REVOKE ALL ON public.pilot_manual_whatsapp_cloud_send_attempts,
  public.pilot_manual_whatsapp_cloud_send_events FROM lead_finder_api_runtime;

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
    RETURNING id, reserved_at, false, NULL::text, NULL::char(64), NULL::text, NULL::timestamptz;
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
    RETURNING id, created_at, event_type, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char), public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char), public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char), public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char), public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text) TO lead_finder_api_runtime;
  END IF;
END
$$;

ALTER TABLE public.pilot_manual_whatsapp_cloud_send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_manual_whatsapp_cloud_send_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_manual_whatsapp_cloud_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'manual WhatsApp Cloud audit is append-only'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_manual_whatsapp_cloud_attempts_append_only ON public.pilot_manual_whatsapp_cloud_send_attempts;
CREATE TRIGGER pilot_manual_whatsapp_cloud_attempts_append_only
  BEFORE UPDATE OR DELETE ON public.pilot_manual_whatsapp_cloud_send_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_whatsapp_cloud_attempt_mutation();
DROP TRIGGER IF EXISTS pilot_manual_whatsapp_cloud_events_append_only ON public.pilot_manual_whatsapp_cloud_send_events;
CREATE TRIGGER pilot_manual_whatsapp_cloud_events_append_only
  BEFORE UPDATE OR DELETE ON public.pilot_manual_whatsapp_cloud_send_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_whatsapp_cloud_attempt_mutation();

COMMIT;
