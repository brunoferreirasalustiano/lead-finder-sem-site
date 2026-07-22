CREATE TABLE IF NOT EXISTS contact_channel_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL, lead_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = 'WHATSAPP'), purpose text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 100),
  origin text NOT NULL CHECK (origin IN ('DIRECT_OPT_IN','FORM_OPT_IN','SIGNED_RECORD')),
  evidence_fingerprint char(64) NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz NOT NULL, recorded_by text NOT NULL CHECK (char_length(btrim(recorded_by)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id,lead_id) REFERENCES lead_contacts(id,lead_id) ON DELETE RESTRICT,
  UNIQUE (contact_id,channel,purpose,evidence_fingerprint)
);
CREATE INDEX IF NOT EXISTS contact_channel_authorizations_lookup_idx ON contact_channel_authorizations(lead_id,contact_id,channel,granted_at DESC);

-- This is business-ownership evidence, not consent or opt-in. The greatest version is current.
CREATE TABLE IF NOT EXISTS contact_email_business_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL, lead_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  ownership text NOT NULL CHECK (ownership IN ('BUSINESS','PERSONAL','UNKNOWN')),
  origin text NOT NULL CHECK (origin IN ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD')),
  evidence_fingerprint char(64) NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  human_decision text NOT NULL CHECK (human_decision IN ('APPROVED','REJECTED')),
  reviewer_principal_id text NOT NULL CHECK (char_length(btrim(reviewer_principal_id)) BETWEEN 1 AND 100),
  version integer NOT NULL CHECK (version > 0), recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id,lead_id) REFERENCES lead_contacts(id,lead_id) ON DELETE RESTRICT,
  UNIQUE (contact_id,version), UNIQUE (contact_id,evidence_fingerprint)
);
CREATE INDEX IF NOT EXISTS contact_email_business_evidence_current_idx ON contact_email_business_evidence(contact_id,version DESC);

CREATE OR REPLACE FUNCTION validate_email_business_evidence_append() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE expected_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('email-business-evidence:' || NEW.contact_id::text,0));
  SELECT coalesce(max(version),0)+1 INTO expected_version FROM public.contact_email_business_evidence WHERE contact_id=NEW.contact_id;
  IF NEW.version <> expected_version THEN RAISE EXCEPTION 'email business evidence version must be %', expected_version USING ERRCODE='23514'; END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contact_email_business_evidence_validate ON contact_email_business_evidence;
CREATE TRIGGER contact_email_business_evidence_validate BEFORE INSERT ON contact_email_business_evidence FOR EACH ROW EXECUTE FUNCTION validate_email_business_evidence_append();

CREATE TABLE IF NOT EXISTS pilot_manual_message_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL, lead_id uuid NOT NULL, contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL')), template_id text NOT NULL, template_version text NOT NULL,
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'), idempotency_key text NOT NULL,
  result_fingerprint char(64) NOT NULL CHECK (result_fingerprint ~ '^[0-9a-f]{64}$'),
  result_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(result_snapshot)='object'
    AND result_snapshot ?& ARRAY['channel','templateId','templateVersion','variables','contactFingerprint','messageFingerprint']
    AND NOT (result_snapshot ?| ARRAY['message','subject','link','url','contactValue'])
  ),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pilot_run_id,lead_id) REFERENCES pilot_leads(pilot_run_id,lead_id) ON DELETE RESTRICT,
  FOREIGN KEY (contact_id,lead_id) REFERENCES lead_contacts(id,lead_id) ON DELETE RESTRICT,
  UNIQUE (pilot_run_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS pilot_manual_message_preparations_lead_idx ON pilot_manual_message_preparations(pilot_run_id,lead_id,prepared_at DESC);

CREATE TABLE IF NOT EXISTS pilot_manual_message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preparation_id uuid NOT NULL REFERENCES pilot_manual_message_preparations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('OPENED','CONTACT_CONFIRMED','RESPONSE_RECORDED')),
  result text CHECK (
    (event_type='OPENED' AND result IS NULL) OR
    (event_type='CONTACT_CONFIRMED' AND result IN ('SENT_CONFIRMED','NOT_SENT','INVALID_CONTACT','CHANNEL_UNAVAILABLE','OPERATIONAL_ERROR')) OR
    (event_type='RESPONSE_RECORDED' AND result IN ('POSITIVE_REPLY','NEGATIVE_REPLY','OPT_OUT'))
  ),
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  observation text CHECK (observation IS NULL OR char_length(observation)<=500),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(preparation_id,event_type,idempotency_key)
);
CREATE INDEX IF NOT EXISTS pilot_manual_message_events_preparation_idx ON pilot_manual_message_events(preparation_id,created_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS pilot_manual_message_events_one_open_idx ON pilot_manual_message_events(preparation_id) WHERE event_type='OPENED';
CREATE UNIQUE INDEX IF NOT EXISTS pilot_manual_message_events_one_confirmation_idx ON pilot_manual_message_events(preparation_id) WHERE event_type='CONTACT_CONFIRMED';
CREATE UNIQUE INDEX IF NOT EXISTS pilot_manual_message_events_one_response_idx ON pilot_manual_message_events(preparation_id) WHERE event_type='RESPONSE_RECORDED';

CREATE OR REPLACE FUNCTION validate_manual_message_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE opened boolean; confirmation text; response_exists boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-message-preparation:' || NEW.preparation_id::text,0));
  SELECT EXISTS(SELECT 1 FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='OPENED'),
         (SELECT result FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='CONTACT_CONFIRMED'),
         EXISTS(SELECT 1 FROM public.pilot_manual_message_events WHERE preparation_id=NEW.preparation_id AND event_type='RESPONSE_RECORDED')
    INTO opened,confirmation,response_exists;
  IF NEW.event_type='OPENED' AND (opened OR confirmation IS NOT NULL OR response_exists) THEN RAISE EXCEPTION 'invalid OPENED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type='CONTACT_CONFIRMED' AND (NOT opened OR confirmation IS NOT NULL OR response_exists) THEN RAISE EXCEPTION 'invalid CONTACT_CONFIRMED transition' USING ERRCODE='23514'; END IF;
  IF NEW.event_type='RESPONSE_RECORDED' AND (confirmation IS DISTINCT FROM 'SENT_CONFIRMED' OR response_exists) THEN RAISE EXCEPTION 'invalid RESPONSE_RECORDED transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pilot_manual_message_transition_guard ON pilot_manual_message_events;
CREATE TRIGGER pilot_manual_message_transition_guard BEFORE INSERT ON pilot_manual_message_events FOR EACH ROW EXECUTE FUNCTION validate_manual_message_transition();

-- Serialize suppression writes with eligibility checks so a committed opt-out always wins.
CREATE OR REPLACE FUNCTION lock_manual_messaging_suppression() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || NEW.lead_id::text,0)); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS campaign_opt_outs_manual_messaging_lock ON campaign_opt_outs;
CREATE TRIGGER campaign_opt_outs_manual_messaging_lock BEFORE INSERT ON campaign_opt_outs FOR EACH ROW EXECUTE FUNCTION lock_manual_messaging_suppression();

CREATE OR REPLACE FUNCTION reject_manual_messaging_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['contact_channel_authorizations','contact_email_business_evidence','pilot_manual_message_preparations','pilot_manual_message_events'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON public.%I',n,n);EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_manual_messaging_history_mutation()',n,n);END LOOP;END $$;

ALTER TABLE contact_channel_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_email_business_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_manual_message_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_manual_message_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_channel_authorizations,contact_email_business_evidence,pilot_manual_message_preparations,pilot_manual_message_events FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation(),lock_manual_messaging_suppression(),validate_manual_message_transition(),validate_email_business_evidence_append() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON contact_channel_authorizations,contact_email_business_evidence,pilot_manual_message_preparations,pilot_manual_message_events FROM anon';EXECUTE 'REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation(),lock_manual_messaging_suppression(),validate_manual_message_transition(),validate_email_business_evidence_append() FROM anon';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON contact_channel_authorizations,contact_email_business_evidence,pilot_manual_message_preparations,pilot_manual_message_events FROM authenticated';EXECUTE 'REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation(),lock_manual_messaging_suppression(),validate_manual_message_transition(),validate_email_business_evidence_append() FROM authenticated';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT ON contact_channel_authorizations,contact_email_business_evidence,pilot_manual_message_preparations,pilot_manual_message_events TO service_role';END IF;
END $$;
