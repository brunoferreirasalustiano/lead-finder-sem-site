CREATE TABLE IF NOT EXISTS contact_channel_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL, lead_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP')), purpose text NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 1 AND 100),
  origin text NOT NULL CHECK (origin IN ('DIRECT_OPT_IN','FORM_OPT_IN','SIGNED_RECORD')),
  evidence_fingerprint char(64) NOT NULL CHECK (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz NOT NULL, recorded_by text NOT NULL CHECK (char_length(btrim(recorded_by)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id, lead_id) REFERENCES lead_contacts(id, lead_id) ON DELETE RESTRICT,
  UNIQUE (contact_id, channel, purpose, evidence_fingerprint)
);
CREATE INDEX IF NOT EXISTS contact_channel_authorizations_lookup_idx ON contact_channel_authorizations(lead_id,contact_id,channel,granted_at DESC);

CREATE TABLE IF NOT EXISTS pilot_manual_message_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL, lead_id uuid NOT NULL, contact_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL')), template_id text NOT NULL, template_version text NOT NULL,
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'), idempotency_key text NOT NULL,
  result_fingerprint char(64) NOT NULL CHECK (result_fingerprint ~ '^[0-9a-f]{64}$'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot)='object'),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pilot_run_id,lead_id) REFERENCES pilot_leads(pilot_run_id,lead_id) ON DELETE RESTRICT,
  FOREIGN KEY (contact_id,lead_id) REFERENCES lead_contacts(id,lead_id) ON DELETE RESTRICT,
  UNIQUE (pilot_run_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS pilot_manual_message_preparations_lead_idx ON pilot_manual_message_preparations(pilot_run_id,lead_id,prepared_at DESC);

CREATE TABLE IF NOT EXISTS pilot_manual_message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preparation_id uuid NOT NULL REFERENCES pilot_manual_message_preparations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('OPENED','CONTACT_CONFIRMED')),
  result text CHECK ((event_type='OPENED' AND result IS NULL) OR (event_type='CONTACT_CONFIRMED' AND result IN ('SENT_CONFIRMED','NOT_SENT','INVALID_CONTACT','CHANNEL_UNAVAILABLE','POSITIVE_REPLY','NEGATIVE_REPLY','OPT_OUT','OPERATIONAL_ERROR'))),
  operator_principal_id text NOT NULL CHECK (char_length(btrim(operator_principal_id)) BETWEEN 1 AND 100),
  observation text CHECK (observation IS NULL OR char_length(observation)<=500), payload_fingerprint char(64) NOT NULL,
  idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(preparation_id,event_type,idempotency_key)
);
CREATE INDEX IF NOT EXISTS pilot_manual_message_events_preparation_idx ON pilot_manual_message_events(preparation_id,created_at,id);

-- campaign_opt_outs is the single authority for revocation. Serialize suppression writes
-- with manual eligibility checks so a committed opt-out always wins before confirmation.
CREATE OR REPLACE FUNCTION lock_manual_messaging_suppression() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || NEW.lead_id::text,0));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_opt_outs_manual_messaging_lock ON campaign_opt_outs;
CREATE TRIGGER campaign_opt_outs_manual_messaging_lock BEFORE INSERT ON campaign_opt_outs FOR EACH ROW EXECUTE FUNCTION lock_manual_messaging_suppression();

CREATE OR REPLACE FUNCTION reject_manual_messaging_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['contact_channel_authorizations','pilot_manual_message_preparations','pilot_manual_message_events'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON public.%I',n,n);EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_manual_messaging_history_mutation()',n,n);END LOOP;END $$;

ALTER TABLE contact_channel_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_manual_message_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_manual_message_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_channel_authorizations,pilot_manual_message_preparations,pilot_manual_message_events FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_manual_messaging_suppression() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON contact_channel_authorizations,pilot_manual_message_preparations,pilot_manual_message_events FROM anon';EXECUTE 'REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation(),lock_manual_messaging_suppression() FROM anon';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON contact_channel_authorizations,pilot_manual_message_preparations,pilot_manual_message_events FROM authenticated';EXECUTE 'REVOKE ALL ON FUNCTION reject_manual_messaging_history_mutation(),lock_manual_messaging_suppression() FROM authenticated';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'GRANT SELECT,INSERT ON contact_channel_authorizations,pilot_manual_message_preparations,pilot_manual_message_events TO service_role';EXECUTE 'GRANT EXECUTE ON FUNCTION lock_manual_messaging_suppression() TO service_role';END IF;
END $$;
