BEGIN;

-- Preserve only the small, redacted subset of Meta diagnostics needed to
-- classify a rejection. Raw provider bodies, payloads, tokens and contact
-- values are intentionally never persisted.
ALTER TABLE public.pilot_manual_whatsapp_cloud_send_events
  ADD COLUMN IF NOT EXISTS provider_http_status smallint
    CHECK (provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
  ADD COLUMN IF NOT EXISTS meta_error_type text
    CHECK (meta_error_type IS NULL OR meta_error_type ~ '^[A-Za-z][A-Za-z0-9_.-]{0,99}$'),
  ADD COLUMN IF NOT EXISTS meta_error_code text
    CHECK (meta_error_code IS NULL OR meta_error_code ~ '^[A-Za-z0-9_.-]{1,100}$'),
  ADD COLUMN IF NOT EXISTS meta_error_subcode text
    CHECK (meta_error_subcode IS NULL OR meta_error_subcode ~ '^[A-Za-z0-9_.-]{1,100}$'),
  ADD COLUMN IF NOT EXISTS fbtrace_id text
    CHECK (fbtrace_id IS NULL OR fbtrace_id ~ '^[A-Za-z0-9_.-]{1,200}$');

-- Keep the original four-argument function for compatibility and expose a
-- separate, least-privilege overload for sanitized provider diagnostics.
CREATE OR REPLACE FUNCTION public.append_manual_whatsapp_cloud_send_event(
  p_attempt_id uuid,
  p_event_type text,
  p_provider_message_fingerprint char(64),
  p_error_code text,
  p_provider_http_status smallint,
  p_meta_error_type text,
  p_meta_error_code text,
  p_meta_error_subcode text,
  p_fbtrace_id text
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
      OR prior.error_code IS DISTINCT FROM p_error_code
      OR prior.provider_http_status IS DISTINCT FROM p_provider_http_status
      OR prior.meta_error_type IS DISTINCT FROM p_meta_error_type
      OR prior.meta_error_code IS DISTINCT FROM p_meta_error_code
      OR prior.meta_error_subcode IS DISTINCT FROM p_meta_error_subcode
      OR prior.fbtrace_id IS DISTINCT FROM p_fbtrace_id THEN
      RAISE EXCEPTION 'whatsapp cloud send event conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT prior.id, prior.created_at, prior.event_type, true;
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO public.pilot_manual_whatsapp_cloud_send_events(
      attempt_id, event_type, provider_message_fingerprint, error_code,
      provider_http_status, meta_error_type, meta_error_code,
      meta_error_subcode, fbtrace_id
    ) VALUES (
      p_attempt_id, p_event_type, p_provider_message_fingerprint, p_error_code,
      p_provider_http_status, p_meta_error_type, p_meta_error_code,
      p_meta_error_subcode, p_fbtrace_id
    )
    RETURNING public.pilot_manual_whatsapp_cloud_send_events.id,
      public.pilot_manual_whatsapp_cloud_send_events.created_at,
      public.pilot_manual_whatsapp_cloud_send_events.event_type, false;
END;
$$;

REVOKE ALL ON FUNCTION public.append_manual_whatsapp_cloud_send_event(
  uuid, text, char, text, smallint, text, text, text, text
) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.append_manual_whatsapp_cloud_send_event(
      uuid, text, char, text, smallint, text, text, text, text
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.append_manual_whatsapp_cloud_send_event(
      uuid, text, char, text, smallint, text, text, text, text
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.append_manual_whatsapp_cloud_send_event(
      uuid, text, char, text, smallint, text, text, text, text
    ) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.append_manual_whatsapp_cloud_send_event(
      uuid, text, char, text, smallint, text, text, text, text
    ) TO lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
