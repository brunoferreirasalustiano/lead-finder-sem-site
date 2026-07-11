DO $$ BEGIN
  CREATE TYPE qualification_status AS ENUM ('PENDENTE','VALIDANDO','SITE_ENCONTRADO','SEM_SITE_CONFIRMADO','INCONCLUSIVO','DESCARTADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualification_status qualification_status NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS normalized_address text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS lead_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source text NOT NULL, reference text, result text NOT NULL, confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  observed_at timestamptz NOT NULL, notes text, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS lead_evidence_lead_created_idx ON lead_evidence(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('TELEFONE','EMAIL')), original_value text NOT NULL, normalized_value text NOT NULL,
  source text NOT NULL, confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1), verified_at timestamptz,
  is_valid boolean NOT NULL DEFAULT false, possible_whatsapp boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, type, normalized_value)
);
CREATE INDEX IF NOT EXISTS lead_contacts_lead_idx ON lead_contacts(lead_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lead_contacts_verified_phone_uidx ON lead_contacts(normalized_value) WHERE type = 'TELEFONE' AND is_valid;

CREATE TABLE IF NOT EXISTS lead_qualification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type text NOT NULL, previous_value jsonb, new_value jsonb NOT NULL, actor text NOT NULL,
  source text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_history_lead_created_idx ON lead_qualification_history(lead_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS leads_normalized_identity_uidx ON leads(normalized_name, normalized_address)
  WHERE normalized_name IS NOT NULL AND normalized_address IS NOT NULL;
