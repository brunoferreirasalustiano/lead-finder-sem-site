BEGIN;

ALTER TABLE public.pilot_manual_message_preparations
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Legacy preparations are intentionally backfilled conservatively. A record
-- older than the 24-hour window is immediately expired rather than remaining
-- usable without an explicit new preparation.
-- The append-only trigger is suspended only inside this migration transaction
-- because this is the controlled schema backfill itself; it is restored before
-- the transaction commits and remains active for all application writes. Keep
-- the trigger object intact so its catalog identity remains stable.
ALTER TABLE public.pilot_manual_message_preparations
  DISABLE TRIGGER pilot_manual_message_preparations_append_only;
UPDATE public.pilot_manual_message_preparations
SET expires_at = prepared_at + interval '24 hours'
WHERE expires_at IS NULL;
ALTER TABLE public.pilot_manual_message_preparations
  ENABLE TRIGGER pilot_manual_message_preparations_append_only;

ALTER TABLE public.pilot_manual_message_preparations
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.pilot_manual_message_preparations
  DROP CONSTRAINT IF EXISTS pilot_manual_message_preparations_expiry_after_prepare_check;
ALTER TABLE public.pilot_manual_message_preparations
  ADD CONSTRAINT pilot_manual_message_preparations_expiry_after_prepare_check
  CHECK (expires_at > prepared_at);

CREATE INDEX IF NOT EXISTS pilot_manual_message_preparations_expiry_idx
  ON public.pilot_manual_message_preparations(pilot_run_id, expires_at);

ALTER TABLE public.pilot_manual_message_events
  DROP CONSTRAINT IF EXISTS pilot_manual_message_events_event_type_check,
  DROP CONSTRAINT IF EXISTS pilot_manual_message_events_result_check,
  -- Migration 0019 declared the event check inline, so PostgreSQL generated
  -- this legacy name instead of separate event/result constraints.
  DROP CONSTRAINT IF EXISTS pilot_manual_message_events_check;

ALTER TABLE public.pilot_manual_message_events
  ADD CONSTRAINT pilot_manual_message_events_event_type_check
  CHECK (event_type IN ('OPENED','CONTACT_CONFIRMED','RESPONSE_RECORDED','CANCELLED')),
  ADD CONSTRAINT pilot_manual_message_events_result_check
  CHECK (
    (event_type IN ('OPENED','CANCELLED') AND result IS NULL) OR
    (event_type='CONTACT_CONFIRMED' AND result IN ('SENT_CONFIRMED','NOT_SENT','INVALID_CONTACT','CHANNEL_UNAVAILABLE','OPERATIONAL_ERROR')) OR
    (event_type='RESPONSE_RECORDED' AND result IN ('POSITIVE_REPLY','NEGATIVE_REPLY','OPT_OUT'))
  );

CREATE UNIQUE INDEX IF NOT EXISTS pilot_manual_message_events_one_cancel_idx
  ON public.pilot_manual_message_events(preparation_id)
  WHERE event_type='CANCELLED';

CREATE OR REPLACE FUNCTION public.validate_manual_message_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  opened boolean;
  confirmation text;
  response_exists boolean;
  cancelled boolean;
  expired boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-message-preparation:' || NEW.preparation_id::text,0));
  SELECT
    EXISTS(SELECT 1 FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='OPENED'),
    (SELECT result FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='CONTACT_CONFIRMED'),
    EXISTS(SELECT 1 FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='RESPONSE_RECORDED'),
    EXISTS(SELECT 1 FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='CANCELLED'),
    EXISTS(SELECT 1 FROM public.pilot_manual_message_preparations WHERE id=NEW.preparation_id AND expires_at <= clock_timestamp())
  INTO opened,confirmation,response_exists,cancelled,expired;

  IF NEW.event_type='CANCELLED' AND (cancelled OR confirmation IS NOT NULL OR response_exists)
    THEN RAISE EXCEPTION 'invalid CANCELLED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type='OPENED' AND (opened OR confirmation IS NOT NULL OR response_exists OR cancelled)
    THEN RAISE EXCEPTION 'invalid OPENED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type='CONTACT_CONFIRMED' AND (NOT opened OR confirmation IS NOT NULL OR response_exists OR cancelled)
    THEN RAISE EXCEPTION 'invalid CONTACT_CONFIRMED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type='RESPONSE_RECORDED' AND (confirmation IS DISTINCT FROM 'SENT_CONFIRMED' OR response_exists OR cancelled)
    THEN RAISE EXCEPTION 'invalid RESPONSE_RECORDED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type <> 'CANCELLED' AND expired
    THEN RAISE EXCEPTION 'manual message preparation expired' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;

COMMIT;
