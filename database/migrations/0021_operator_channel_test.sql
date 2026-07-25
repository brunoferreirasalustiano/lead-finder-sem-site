CREATE TABLE IF NOT EXISTS operator_channel_test_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel = 'WHATSAPP'),
  purpose text NOT NULL DEFAULT 'OPERATOR_TEST' CHECK (purpose = 'OPERATOR_TEST'),
  recipient_fingerprint char(64) NOT NULL CHECK (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  template_id text NOT NULL CHECK (char_length(btrim(template_id)) BETWEEN 1 AND 100),
  template_version text NOT NULL CHECK (template_version ~ '^v[1-9][0-9]*$'),
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  result_fingerprint char(64) NOT NULL CHECK (result_fingerprint ~ '^[0-9a-f]{64}$'),
  result_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(result_snapshot) = 'object'
    AND result_snapshot ?& ARRAY[
      'channel',
      'purpose',
      'templateId',
      'templateVersion',
      'recipientFingerprint',
      'messageFingerprint'
    ]
    AND NOT (result_snapshot ?| ARRAY[
      'phone',
      'telephone',
      'whatsapp',
      'recipient',
      'recipientValue',
      'contactValue',
      'message',
      'body',
      'subject',
      'link',
      'url'
    ])
  ),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_principal_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS operator_channel_test_preparations_principal_idx
  ON operator_channel_test_preparations(operator_principal_id, prepared_at DESC);
CREATE INDEX IF NOT EXISTS operator_channel_test_preparations_recipient_idx
  ON operator_channel_test_preparations(recipient_fingerprint, prepared_at DESC);

CREATE TABLE IF NOT EXISTS operator_channel_test_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES operator_channel_test_preparations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('OPENED','CONTACT_CONFIRMED','RESPONSE_RECORDED')),
  result text CHECK (
    (event_type = 'OPENED' AND result IS NULL) OR
    (event_type = 'CONTACT_CONFIRMED' AND result IN ('SENT_CONFIRMED','NOT_SENT','OPERATIONAL_ERROR')) OR
    (event_type = 'RESPONSE_RECORDED' AND result IN ('RECEIVED_CONFIRMED','NOT_RECEIVED','READ_CONFIRMED'))
  ),
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preparation_id, event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS operator_channel_test_events_preparation_idx
  ON operator_channel_test_events(preparation_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS operator_channel_test_events_one_open_idx
  ON operator_channel_test_events(preparation_id) WHERE event_type = 'OPENED';
CREATE UNIQUE INDEX IF NOT EXISTS operator_channel_test_events_one_confirmation_idx
  ON operator_channel_test_events(preparation_id) WHERE event_type = 'CONTACT_CONFIRMED';
CREATE UNIQUE INDEX IF NOT EXISTS operator_channel_test_events_one_response_idx
  ON operator_channel_test_events(preparation_id) WHERE event_type = 'RESPONSE_RECORDED';

CREATE OR REPLACE FUNCTION validate_operator_channel_test_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  opened boolean;
  confirmation text;
  response_exists boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('operator-channel-test:' || NEW.preparation_id::text, 0)
  );

  SELECT
    EXISTS(
      SELECT 1 FROM public.operator_channel_test_events
      WHERE preparation_id = NEW.preparation_id AND event_type = 'OPENED'
    ),
    (
      SELECT result FROM public.operator_channel_test_events
      WHERE preparation_id = NEW.preparation_id AND event_type = 'CONTACT_CONFIRMED'
    ),
    EXISTS(
      SELECT 1 FROM public.operator_channel_test_events
      WHERE preparation_id = NEW.preparation_id AND event_type = 'RESPONSE_RECORDED'
    )
  INTO opened, confirmation, response_exists;

  IF NEW.event_type = 'OPENED' AND (opened OR confirmation IS NOT NULL OR response_exists) THEN
    RAISE EXCEPTION 'invalid operator test OPENED transition' USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'CONTACT_CONFIRMED' AND (NOT opened OR confirmation IS NOT NULL OR response_exists) THEN
    RAISE EXCEPTION 'invalid operator test CONTACT_CONFIRMED transition' USING ERRCODE = '23514';
  END IF;

  IF NEW.event_type = 'RESPONSE_RECORDED' AND (
    confirmation IS DISTINCT FROM 'SENT_CONFIRMED' OR response_exists
  ) THEN
    RAISE EXCEPTION 'invalid operator test RESPONSE_RECORDED transition' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS operator_channel_test_transition_guard ON operator_channel_test_events;
CREATE TRIGGER operator_channel_test_transition_guard
  BEFORE INSERT ON operator_channel_test_events
  FOR EACH ROW EXECUTE FUNCTION validate_operator_channel_test_transition();

CREATE OR REPLACE FUNCTION reject_operator_channel_test_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS operator_channel_test_preparations_append_only
  ON operator_channel_test_preparations;
CREATE TRIGGER operator_channel_test_preparations_append_only
  BEFORE UPDATE OR DELETE ON operator_channel_test_preparations
  FOR EACH ROW EXECUTE FUNCTION reject_operator_channel_test_history_mutation();

DROP TRIGGER IF EXISTS operator_channel_test_events_append_only
  ON operator_channel_test_events;
CREATE TRIGGER operator_channel_test_events_append_only
  BEFORE UPDATE OR DELETE ON operator_channel_test_events
  FOR EACH ROW EXECUTE FUNCTION reject_operator_channel_test_history_mutation();

ALTER TABLE operator_channel_test_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_channel_test_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON operator_channel_test_preparations, operator_channel_test_events FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_operator_channel_test_transition(), reject_operator_channel_test_history_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON operator_channel_test_preparations, operator_channel_test_events FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION validate_operator_channel_test_transition(), reject_operator_channel_test_history_mutation() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON operator_channel_test_preparations, operator_channel_test_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION validate_operator_channel_test_transition(), reject_operator_channel_test_history_mutation() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT ON operator_channel_test_preparations, operator_channel_test_events TO service_role';
  END IF;
END
$$;