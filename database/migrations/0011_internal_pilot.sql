CREATE TABLE IF NOT EXISTS pilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  region text NOT NULL CHECK (char_length(btrim(region)) BETWEEN 1 AND 200), category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 200),
  target_lead_count integer NOT NULL CHECK (target_lead_count BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','RUNNING','PAUSED','COMPLETED','CANCELLED')),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE RESTRICT, created_by text NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100),
  started_at timestamptz, completed_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at), CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pilot_runs_status_updated_idx ON pilot_runs(status, updated_at, id);

CREATE TABLE IF NOT EXISTS pilot_leads (
  pilot_run_id uuid NOT NULL REFERENCES pilot_runs(id) ON DELETE RESTRICT, lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('SYNTHETIC','MANUAL_IMPORT','COLLECTION')), added_by text NOT NULL CHECK (char_length(btrim(added_by)) BETWEEN 1 AND 100),
  added_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK (version > 0), PRIMARY KEY (pilot_run_id, lead_id)
);
CREATE INDEX IF NOT EXISTS pilot_leads_lead_idx ON pilot_leads(lead_id);
-- PostgreSQL is the authority for the cross-run active claim. Terminal runs cease to conflict.
CREATE OR REPLACE FUNCTION reject_concurrent_active_pilot_lead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.lead_id::text, 0));
  IF EXISTS (SELECT 1 FROM pilot_leads pl JOIN pilot_runs pr ON pr.id=pl.pilot_run_id
    WHERE pl.lead_id=NEW.lead_id AND pl.pilot_run_id<>NEW.pilot_run_id AND pr.status NOT IN ('COMPLETED','CANCELLED'))
  THEN RAISE EXCEPTION 'lead already belongs to active pilot' USING ERRCODE='23505', CONSTRAINT='pilot_leads_one_active_run'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pilot_leads_active_claim_trigger ON pilot_leads;
CREATE TRIGGER pilot_leads_active_claim_trigger BEFORE INSERT OR UPDATE ON pilot_leads FOR EACH ROW EXECUTE FUNCTION reject_concurrent_active_pilot_lead();

CREATE TABLE IF NOT EXISTS pilot_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL, lead_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','NEEDS_REVIEW')), reason text CHECK (reason IS NULL OR char_length(reason)<=1000),
  reviewer_principal_id text NOT NULL CHECK (char_length(btrim(reviewer_principal_id)) BETWEEN 1 AND 100), reviewed_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL CHECK (version > 0), UNIQUE(pilot_run_id,lead_id,version),
  FOREIGN KEY(pilot_run_id,lead_id) REFERENCES pilot_leads(pilot_run_id,lead_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS pilot_reviews_current_idx ON pilot_reviews(pilot_run_id,lead_id,version DESC);

CREATE TABLE IF NOT EXISTS pilot_manual_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL, lead_id uuid NOT NULL,
 contact_id uuid NOT NULL REFERENCES lead_contacts(id) ON DELETE RESTRICT, channel text NOT NULL CHECK(channel IN ('WHATSAPP_MANUAL','EMAIL_MANUAL','PHONE','OTHER')),
 approved_template_version_id text NOT NULL CHECK(char_length(btrim(approved_template_version_id)) BETWEEN 1 AND 200), operator_principal_id text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(), request_id text CHECK(request_id IS NULL OR char_length(request_id)<=100), observation text CHECK(observation IS NULL OR char_length(observation)<=500),
 idempotency_key text NOT NULL, payload_fingerprint char(64) NOT NULL, UNIQUE(pilot_run_id,idempotency_key),
 FOREIGN KEY(pilot_run_id,lead_id) REFERENCES pilot_leads(pilot_run_id,lead_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS pilot_manual_contacts_snapshot_idx ON pilot_manual_contacts(pilot_run_id,recorded_at,id);

CREATE TABLE IF NOT EXISTS pilot_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL, lead_id uuid NOT NULL,
 result text NOT NULL CHECK(result IN ('NOT_CONTACTED','CONTACTED','NO_RESPONSE','RESPONDED','INTERESTED','MEETING_REQUESTED','PROPOSAL_REQUESTED','NOT_INTERESTED','INVALID_CONTACT','DO_NOT_CONTACT','CONVERTED')),
 channel text CHECK(channel IS NULL OR channel IN ('WHATSAPP_MANUAL','EMAIL_MANUAL','PHONE','OTHER')), principal_id text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 reason text CHECK(reason IS NULL OR char_length(reason)<=1000), next_action text CHECK(next_action IS NULL OR char_length(next_action)<=500), human_confirmed boolean NOT NULL DEFAULT false,
 version integer NOT NULL CHECK(version>0), idempotency_key text NOT NULL, payload_fingerprint char(64) NOT NULL,
 UNIQUE(pilot_run_id,idempotency_key), UNIQUE(pilot_run_id,lead_id,version), CHECK(result<>'CONVERTED' OR human_confirmed),
 FOREIGN KEY(pilot_run_id,lead_id) REFERENCES pilot_leads(pilot_run_id,lead_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS pilot_results_snapshot_idx ON pilot_results(pilot_run_id,recorded_at,id);

CREATE TABLE IF NOT EXISTS pilot_timeline_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pilot_run_id uuid NOT NULL REFERENCES pilot_runs(id) ON DELETE RESTRICT,
 lead_id uuid REFERENCES leads(id) ON DELETE RESTRICT, event_type text NOT NULL, principal_id text NOT NULL,
 previous_value jsonb, new_value jsonb NOT NULL CHECK(jsonb_typeof(new_value)='object'), metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pilot_timeline_run_created_idx ON pilot_timeline_events(pilot_run_id,created_at,id);

CREATE OR REPLACE FUNCTION reject_pilot_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000';
END $$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['pilot_reviews','pilot_manual_contacts','pilot_results','pilot_timeline_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_pilot_history_mutation()', table_name, table_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS pilot_idempotency_keys (
 scope text NOT NULL, idempotency_key text NOT NULL, payload_fingerprint char(64) NOT NULL, resource_type text NOT NULL,
 resource_id uuid NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,idempotency_key)
);
