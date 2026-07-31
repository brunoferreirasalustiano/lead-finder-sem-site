-- Align operator email audit persistence with the active Gmail API transport.
-- Historical GMAIL_SMTP rows remain valid and append-only; all new events created
-- through the restricted SECURITY DEFINER function are recorded as GMAIL_API.

ALTER TABLE public.operator_email_test_events
  DROP CONSTRAINT IF EXISTS operator_email_test_events_provider_check;

ALTER TABLE public.operator_email_test_events
  ADD CONSTRAINT operator_email_test_events_provider_check
  CHECK (provider IN ('GMAIL_SMTP', 'GMAIL_API'));

COMMENT ON COLUMN public.operator_email_test_events.provider IS
  'Delivery transport. GMAIL_SMTP is retained only for immutable historical rows; new operator email events use GMAIL_API.';

CREATE OR REPLACE FUNCTION public.append_operator_email_test_event(
  p_attempt_id uuid,
  p_outcome text,
  p_operator_principal_fingerprint char(64),
  p_provider_response_fingerprint char(64),
  p_payload_fingerprint char(64)
)
RETURNS TABLE(id uuid, occurred_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.operator_email_test_events(
    attempt_id,
    outcome,
    provider,
    operator_principal_fingerprint,
    provider_response_fingerprint,
    payload_fingerprint
  ) VALUES (
    p_attempt_id,
    p_outcome,
    'GMAIL_API',
    p_operator_principal_fingerprint,
    p_provider_response_fingerprint,
    p_payload_fingerprint
  )
  RETURNING
    operator_email_test_events.id,
    operator_email_test_events.occurred_at;
$$;

REVOKE ALL ON FUNCTION public.append_operator_email_test_event(uuid, text, char, char, char)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.append_operator_email_test_event(uuid, text, char, char, char) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.append_operator_email_test_event(uuid, text, char, char, char) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.append_operator_email_test_event(uuid, text, char, char, char) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.append_operator_email_test_event(uuid, text, char, char, char) TO lead_finder_api_runtime';
  END IF;
END
$$;
