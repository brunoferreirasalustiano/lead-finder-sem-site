CREATE TABLE IF NOT EXISTS operator_email_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  purpose text NOT NULL DEFAULT 'OPERATOR_TEST' CHECK (purpose = 'OPERATOR_TEST'),
  recipient_fingerprint char(64) NOT NULL
    CHECK (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  sender_fingerprint char(64) NOT NULL
    CHECK (sender_fingerprint ~ '^[0-9a-f]{64}$'),
  operator_principal_fingerprint char(64) NOT NULL
    CHECK (operator_principal_fingerprint ~ '^[0-9a-f]{64}$'),
  template_id text NOT NULL CHECK (template_id = 'operator-email-channel-test'),
  template_version text NOT NULL CHECK (template_version = 'v1'),
  payload_fingerprint char(64) NOT NULL
    CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_fingerprint char(64) NOT NULL
    CHECK (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  message_fingerprint char(64) NOT NULL
    CHECK (message_fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_principal_fingerprint, idempotency_fingerprint),
  UNIQUE (id, operator_principal_fingerprint)
);

CREATE INDEX IF NOT EXISTS operator_email_test_attempts_recipient_idx
  ON operator_email_test_attempts(recipient_fingerprint, reserved_at DESC);

CREATE TABLE IF NOT EXISTS operator_email_test_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('DELIVERED','FAILED')),
  provider text NOT NULL CHECK (provider = 'GMAIL_SMTP'),
  operator_principal_fingerprint char(64) NOT NULL
    CHECK (operator_principal_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_response_fingerprint char(64) NOT NULL
    CHECK (provider_response_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_fingerprint char(64) NOT NULL
    CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id),
  FOREIGN KEY (attempt_id, operator_principal_fingerprint)
    REFERENCES operator_email_test_attempts(id, operator_principal_fingerprint)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS operator_email_test_events_outcome_idx
  ON operator_email_test_events(outcome, occurred_at DESC);

CREATE OR REPLACE FUNCTION reject_operator_email_test_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS operator_email_test_attempts_append_only
  ON operator_email_test_attempts;
CREATE TRIGGER operator_email_test_attempts_append_only
  BEFORE UPDATE OR DELETE ON operator_email_test_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_operator_email_test_history_mutation();

DROP TRIGGER IF EXISTS operator_email_test_events_append_only
  ON operator_email_test_events;
CREATE TRIGGER operator_email_test_events_append_only
  BEFORE UPDATE OR DELETE ON operator_email_test_events
  FOR EACH ROW EXECUTE FUNCTION reject_operator_email_test_history_mutation();

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
    payload_fingerprint,
    idempotency_fingerprint,
    message_fingerprint
  ) VALUES (
    p_recipient_fingerprint,
    p_sender_fingerprint,
    p_operator_principal_fingerprint,
    p_payload_fingerprint,
    p_idempotency_fingerprint,
    p_message_fingerprint
  )
  RETURNING
    operator_email_test_attempts.id,
    operator_email_test_attempts.reserved_at;
$$;

CREATE OR REPLACE FUNCTION append_operator_email_test_event(
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
    'GMAIL_SMTP',
    p_operator_principal_fingerprint,
    p_provider_response_fingerprint,
    p_payload_fingerprint
  )
  RETURNING
    operator_email_test_events.id,
    operator_email_test_events.occurred_at;
$$;

ALTER TABLE operator_email_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_email_test_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  operator_email_test_attempts,
  operator_email_test_events
FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_operator_email_test_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char)
FROM PUBLIC;
REVOKE ALL ON FUNCTION append_operator_email_test_event(uuid, text, char, char, char)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE operator_email_test_attempts, operator_email_test_events FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char), append_operator_email_test_event(uuid, text, char, char, char) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE operator_email_test_attempts, operator_email_test_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char), append_operator_email_test_event(uuid, text, char, char, char) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE operator_email_test_attempts, operator_email_test_events FROM service_role';
    EXECUTE 'GRANT SELECT ON TABLE operator_email_test_attempts, operator_email_test_events TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char), append_operator_email_test_event(uuid, text, char, char, char) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'REVOKE ALL ON TABLE operator_email_test_attempts, operator_email_test_events FROM lead_finder_api_runtime';
    EXECUTE 'GRANT SELECT ON TABLE operator_email_test_attempts, operator_email_test_events TO lead_finder_api_runtime';
    EXECUTE 'GRANT EXECUTE ON FUNCTION create_operator_email_test_attempt(char, char, char, char, char, char), append_operator_email_test_event(uuid, text, char, char, char) TO lead_finder_api_runtime';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_attempts_select ON operator_email_test_attempts';
    EXECUTE 'CREATE POLICY lead_finder_api_runtime_operator_email_attempts_select ON operator_email_test_attempts FOR SELECT TO lead_finder_api_runtime USING (true)';
    EXECUTE 'DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_events_select ON operator_email_test_events';
    EXECUTE 'CREATE POLICY lead_finder_api_runtime_operator_email_events_select ON operator_email_test_events FOR SELECT TO lead_finder_api_runtime USING (true)';
  END IF;
END
$$;
