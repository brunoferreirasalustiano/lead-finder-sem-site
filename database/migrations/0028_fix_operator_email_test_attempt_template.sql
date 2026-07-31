-- Fix the operator-only email test reservation introduced by migration 0027.
-- The table requires immutable template metadata, but the original SECURITY
-- DEFINER function did not provide those two NOT NULL columns.

CREATE OR REPLACE FUNCTION create_operator_email_test_attempt(
  p_recipient_fingerprint char(64),
  p_sender_fingerprint char(64),
  p_operator_principal_fingerprint char(64),
  p_payload_fingerprint char(64),
  p_idempotency_fingerprint char(64),
  p_message_fingerprint char(64)
)
RETURNS TABLE(id uuid, reserved_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.operator_email_test_attempts(
    recipient_fingerprint,
    sender_fingerprint,
    operator_principal_fingerprint,
    template_id,
    template_version,
    payload_fingerprint,
    idempotency_fingerprint,
    message_fingerprint
  ) VALUES (
    p_recipient_fingerprint,
    p_sender_fingerprint,
    p_operator_principal_fingerprint,
    'operator-email-channel-test',
    'v1',
    p_payload_fingerprint,
    p_idempotency_fingerprint,
    p_message_fingerprint
  )
  RETURNING
    operator_email_test_attempts.id,
    operator_email_test_attempts.reserved_at;
$$;

REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char) TO lead_finder_api_runtime';
  END IF;
END
$$;
