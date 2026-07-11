DO $$ BEGIN
  CREATE TYPE validation_status AS ENUM (
    'PENDENTE',
    'VALIDANDO',
    'SITE_ENCONTRADO',
    'SEM_SITE_CONFIRMADO',
    'INCONCLUSIVO',
    'DESCARTADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_type AS ENUM ('TELEFONE', 'WHATSAPP', 'EMAIL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS validation_status validation_status NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text,
  ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_do_not_contact_reason_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_do_not_contact_reason_check CHECK (
    (do_not_contact = false AND do_not_contact_reason IS NULL AND do_not_contact_at IS NULL)
    OR
    (do_not_contact = true AND length(trim(do_not_contact_reason)) > 0 AND do_not_contact_at IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS validation_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source text NOT NULL,
  evidence_type text NOT NULL,
  value text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS validation_evidences_lead_created_idx
  ON validation_evidences(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type contact_type NOT NULL,
  value text NOT NULL,
  normalized_value text NOT NULL,
  source text NOT NULL,
  confidence smallint NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  verified boolean NOT NULL DEFAULT false,
  invalidated_at timestamptz,
  invalidation_reason text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, type, normalized_value),
  UNIQUE (lead_id, idempotency_key),
  CHECK (
    (invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR
    (invalidated_at IS NOT NULL AND length(trim(invalidation_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS lead_contacts_eligibility_idx
  ON lead_contacts(lead_id, verified, invalidated_at, type);

CREATE TABLE IF NOT EXISTS lead_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor text NOT NULL,
  origin text NOT NULL,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS lead_audit_log_lead_created_idx
  ON lead_audit_log(lead_id, created_at DESC);
