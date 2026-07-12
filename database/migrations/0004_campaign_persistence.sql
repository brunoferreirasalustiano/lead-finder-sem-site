CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL,
  state text NOT NULL DEFAULT 'RASCUNHO' CHECK (state IN ('RASCUNHO','ATIVA','PAUSADA','CANCELADA','CONCLUIDA')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL DEFAULT 'RASCUNHO' CHECK (state IN ('RASCUNHO','PENDENTE_APROVACAO','APROVADA','ARQUIVADA')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version_number),
  UNIQUE (id, campaign_id)
);

CREATE TABLE IF NOT EXISTS campaign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_version_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  allowed_variables jsonb NOT NULL CHECK (jsonb_typeof(allowed_variables) = 'array'),
  fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_version_id, channel)
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  campaign_version_id uuid NOT NULL REFERENCES campaign_versions(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP')),
  state text NOT NULL DEFAULT 'PENDENTE' CHECK (state IN ('PENDENTE','ELEGIVEL','BLOQUEADO','EM_ANDAMENTO','CONCLUIDO','CANCELADO','OPT_OUT')),
  recipient_snapshot jsonb NOT NULL CHECK (jsonb_typeof(recipient_snapshot) = 'object'),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, idempotency_key),
  UNIQUE (campaign_id, campaign_version_id, lead_id, channel),
  FOREIGN KEY (campaign_version_id, campaign_id) REFERENCES campaign_versions(id, campaign_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS campaign_recipients_queue_idx
  ON campaign_recipients(state, available_at, id) WHERE state IN ('PENDENTE','ELEGIVEL');

CREATE TABLE IF NOT EXISTS campaign_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES campaign_recipients(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'PENDENTE' CHECK (state IN ('PENDENTE','APROVADA','BLOQUEADA','CANCELADA','CONCLUIDA','FALHOU')),
  payload_snapshot jsonb NOT NULL CHECK (jsonb_typeof(payload_snapshot) = 'object'),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS campaign_attempts_queue_idx
  ON campaign_attempts(state, available_at, id) WHERE state IN ('PENDENTE','APROVADA');

CREATE TABLE IF NOT EXISTS campaign_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES campaign_attempts(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (char_length(btrim(provider)) BETWEEN 1 AND 80),
  external_id text NOT NULL CHECK (char_length(btrim(external_id)) BETWEEN 1 AND 300),
  event_type text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  payload_fingerprint char(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);
CREATE INDEX IF NOT EXISTS campaign_provider_events_attempt_idx
  ON campaign_provider_events(attempt_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS campaign_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  channel text CHECK (channel IS NULL OR channel IN ('EMAIL','WHATSAPP')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  source text NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_opt_outs_global_uidx
  ON campaign_opt_outs(lead_id) WHERE channel IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_opt_outs_channel_uidx
  ON campaign_opt_outs(lead_id, channel) WHERE channel IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL CHECK (char_length(btrim(aggregate_type)) BETWEEN 1 AND 100),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, idempotency_key),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS campaign_outbox_queue_idx
  ON campaign_outbox(status, available_at, id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS campaign_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL UNIQUE REFERENCES campaign_outbox(id) ON DELETE RESTRICT,
  correlation_id text NOT NULL CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  error text NOT NULL CHECK (char_length(btrim(error)) BETWEEN 1 AND 10000),
  attempts integer NOT NULL CHECK (attempts > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_dead_letters_created_idx
  ON campaign_dead_letters(created_at, id);

CREATE OR REPLACE FUNCTION protect_campaign_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION protect_campaign_recipient_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_snapshot IS DISTINCT FROM OLD.recipient_snapshot
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.campaign_version_id IS DISTINCT FROM OLD.campaign_version_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.channel IS DISTINCT FROM OLD.channel THEN
    RAISE EXCEPTION 'campaign recipient snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_campaign_attempt_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.payload_snapshot IS DISTINCT FROM OLD.payload_snapshot
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_fingerprint IS DISTINCT FROM OLD.payload_fingerprint THEN
    RAISE EXCEPTION 'campaign attempt snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_campaign_outbox_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_fingerprint IS DISTINCT FROM OLD.payload_fingerprint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'campaign outbox payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_recipient_snapshot_immutable ON campaign_recipients;
CREATE TRIGGER campaign_recipient_snapshot_immutable BEFORE UPDATE ON campaign_recipients
FOR EACH ROW EXECUTE FUNCTION protect_campaign_recipient_snapshot();
DROP TRIGGER IF EXISTS campaign_recipient_delete_protected ON campaign_recipients;
CREATE TRIGGER campaign_recipient_delete_protected BEFORE DELETE ON campaign_recipients
FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();

DROP TRIGGER IF EXISTS campaign_attempt_snapshot_immutable ON campaign_attempts;
CREATE TRIGGER campaign_attempt_snapshot_immutable BEFORE UPDATE ON campaign_attempts
FOR EACH ROW EXECUTE FUNCTION protect_campaign_attempt_snapshot();
DROP TRIGGER IF EXISTS campaign_outbox_payload_immutable ON campaign_outbox;
CREATE TRIGGER campaign_outbox_payload_immutable BEFORE UPDATE ON campaign_outbox
FOR EACH ROW EXECUTE FUNCTION protect_campaign_outbox_payload();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['campaign_templates','campaign_provider_events','campaign_opt_outs','campaign_dead_letters']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_campaign_history()', table_name, table_name);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS campaign_attempts_delete_protected ON campaign_attempts;
CREATE TRIGGER campaign_attempts_delete_protected BEFORE DELETE ON campaign_attempts
FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();
DROP TRIGGER IF EXISTS campaign_versions_delete_protected ON campaign_versions;
CREATE TRIGGER campaign_versions_delete_protected BEFORE DELETE ON campaign_versions
FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();
DROP TRIGGER IF EXISTS campaign_outbox_delete_protected ON campaign_outbox;
CREATE TRIGGER campaign_outbox_delete_protected BEFORE DELETE ON campaign_outbox
FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();
