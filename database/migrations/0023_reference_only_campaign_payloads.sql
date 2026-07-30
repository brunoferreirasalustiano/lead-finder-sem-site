CREATE OR REPLACE FUNCTION public.pii_safe_campaign_reference_payload(
  p_table_name text,
  p_row jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_table_name = 'campaign_recipients' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'recipientId', p_row -> 'id',
      'campaignId', p_row -> 'campaign_id',
      'campaignVersionId', p_row -> 'campaign_version_id',
      'leadId', p_row -> 'lead_id',
      'channel', p_row -> 'channel',
      'state', p_row -> 'state',
      'version', p_row -> 'version',
      'availableAt', p_row -> 'available_at'
    ));
  END IF;

  IF p_table_name = 'campaign_attempts' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'attemptId', p_row -> 'id',
      'recipientId', p_row -> 'recipient_id',
      'state', p_row -> 'state',
      'version', p_row -> 'version',
      'availableAt', p_row -> 'available_at'
    ));
  END IF;

  IF p_table_name = 'campaign_outbox' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'outboxId', p_row -> 'id',
      'aggregateType', p_row -> 'aggregate_type',
      'aggregateId', p_row -> 'aggregate_id',
      'eventType', p_row -> 'event_type'
    ));
  END IF;

  IF p_table_name = 'campaign_dead_letters' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'deadLetterId', p_row -> 'id',
      'outboxId', p_row -> 'outbox_id',
      'cycle', p_row -> 'cycle',
      'errorCode', p_row -> 'error_code',
      'attempts', p_row -> 'attempts',
      'claimGeneration', p_row -> 'claim_generation'
    ));
  END IF;

  IF p_table_name = 'campaign_provider_events' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'schemaVersion', 1,
      'providerEventId', p_row -> 'id',
      'attemptId', p_row -> 'attempt_id',
      'provider', p_row -> 'provider',
      'eventType', p_row -> 'event_type',
      'occurredAt', p_row -> 'occurred_at'
    ));
  END IF;

  RETURN jsonb_build_object('schemaVersion', 1);
END
$$;

CREATE OR REPLACE FUNCTION public.sanitize_campaign_reference_payload_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'campaign_recipients' THEN
    NEW.recipient_snapshot := public.pii_safe_campaign_reference_payload(TG_TABLE_NAME, to_jsonb(NEW));
  ELSIF TG_TABLE_NAME = 'campaign_attempts' THEN
    NEW.payload_snapshot := public.pii_safe_campaign_reference_payload(TG_TABLE_NAME, to_jsonb(NEW));
  ELSIF TG_TABLE_NAME = 'campaign_outbox' THEN
    NEW.payload := public.pii_safe_campaign_reference_payload(TG_TABLE_NAME, to_jsonb(NEW));
  ELSIF TG_TABLE_NAME = 'campaign_dead_letters' THEN
    NEW.payload := public.pii_safe_campaign_reference_payload(TG_TABLE_NAME, to_jsonb(NEW));
    NEW.error := NEW.error_code;
  ELSIF TG_TABLE_NAME = 'campaign_provider_events' THEN
    NEW.payload := public.pii_safe_campaign_reference_payload(TG_TABLE_NAME, to_jsonb(NEW));
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.pii_safe_campaign_reference_payload(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sanitize_campaign_reference_payload_on_insert() FROM PUBLIC;

ALTER TABLE public.campaign_recipients DISABLE TRIGGER USER;
ALTER TABLE public.campaign_attempts DISABLE TRIGGER USER;
ALTER TABLE public.campaign_outbox DISABLE TRIGGER USER;
ALTER TABLE public.campaign_dead_letters DISABLE TRIGGER USER;
ALTER TABLE public.campaign_provider_events DISABLE TRIGGER USER;

UPDATE public.campaign_recipients recipient
SET recipient_snapshot = public.pii_safe_campaign_reference_payload(
  'campaign_recipients',
  to_jsonb(recipient)
)
WHERE recipient_snapshot IS DISTINCT FROM public.pii_safe_campaign_reference_payload(
  'campaign_recipients',
  to_jsonb(recipient)
);

UPDATE public.campaign_attempts attempt
SET payload_snapshot = public.pii_safe_campaign_reference_payload(
  'campaign_attempts',
  to_jsonb(attempt)
)
WHERE payload_snapshot IS DISTINCT FROM public.pii_safe_campaign_reference_payload(
  'campaign_attempts',
  to_jsonb(attempt)
);

UPDATE public.campaign_outbox outbox_record
SET payload = public.pii_safe_campaign_reference_payload(
  'campaign_outbox',
  to_jsonb(outbox_record)
)
WHERE payload IS DISTINCT FROM public.pii_safe_campaign_reference_payload(
  'campaign_outbox',
  to_jsonb(outbox_record)
);

UPDATE public.campaign_dead_letters dead_letter
SET
  payload = public.pii_safe_campaign_reference_payload(
    'campaign_dead_letters',
    to_jsonb(dead_letter)
  ),
  error = error_code
WHERE
  payload IS DISTINCT FROM public.pii_safe_campaign_reference_payload(
    'campaign_dead_letters',
    to_jsonb(dead_letter)
  )
  OR error IS DISTINCT FROM error_code;

UPDATE public.campaign_provider_events provider_event
SET payload = public.pii_safe_campaign_reference_payload(
  'campaign_provider_events',
  to_jsonb(provider_event)
)
WHERE payload IS DISTINCT FROM public.pii_safe_campaign_reference_payload(
  'campaign_provider_events',
  to_jsonb(provider_event)
);

ALTER TABLE public.campaign_recipients ENABLE TRIGGER USER;
ALTER TABLE public.campaign_attempts ENABLE TRIGGER USER;
ALTER TABLE public.campaign_outbox ENABLE TRIGGER USER;
ALTER TABLE public.campaign_dead_letters ENABLE TRIGGER USER;
ALTER TABLE public.campaign_provider_events ENABLE TRIGGER USER;

DROP TRIGGER IF EXISTS campaign_recipients_reference_payload_guard
  ON public.campaign_recipients;
CREATE TRIGGER campaign_recipients_reference_payload_guard
BEFORE INSERT ON public.campaign_recipients
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_campaign_reference_payload_on_insert();

DROP TRIGGER IF EXISTS campaign_attempts_reference_payload_guard
  ON public.campaign_attempts;
CREATE TRIGGER campaign_attempts_reference_payload_guard
BEFORE INSERT ON public.campaign_attempts
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_campaign_reference_payload_on_insert();

DROP TRIGGER IF EXISTS campaign_outbox_reference_payload_guard
  ON public.campaign_outbox;
CREATE TRIGGER campaign_outbox_reference_payload_guard
BEFORE INSERT ON public.campaign_outbox
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_campaign_reference_payload_on_insert();

DROP TRIGGER IF EXISTS campaign_dead_letters_reference_payload_guard
  ON public.campaign_dead_letters;
CREATE TRIGGER campaign_dead_letters_reference_payload_guard
BEFORE INSERT ON public.campaign_dead_letters
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_campaign_reference_payload_on_insert();

DROP TRIGGER IF EXISTS campaign_provider_events_reference_payload_guard
  ON public.campaign_provider_events;
CREATE TRIGGER campaign_provider_events_reference_payload_guard
BEFORE INSERT ON public.campaign_provider_events
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_campaign_reference_payload_on_insert();

COMMENT ON FUNCTION public.pii_safe_campaign_reference_payload(text, jsonb) IS
  'Reference-only projection for campaign snapshots, outbox, dead letters and provider event JSON.';
