DO $$ BEGIN
  CREATE TYPE crm_stage AS ENUM (
    'NOVO', 'EM_VALIDACAO', 'QUALIFICADO', 'CONTATO_PENDENTE', 'CONTATADO',
    'RESPONDEU', 'REUNIAO', 'PROPOSTA', 'GANHO', 'PERDIDO', 'NAO_CONTATAR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'NOVO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'EM_VALIDACAO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'QUALIFICADO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'CONTATO_PENDENTE';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'CONTATADO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'RESPONDEU';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'REUNIAO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'PROPOSTA';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'GANHO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'PERDIDO';
ALTER TYPE crm_stage ADD VALUE IF NOT EXISTS 'NAO_CONTATAR';

DO $$ BEGIN
  CREATE TYPE crm_priority AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE commercial_task_status AS ENUM ('PENDENTE', 'CONCLUIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_stage crm_stage;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_priority crm_priority NOT NULL DEFAULT 'MEDIA';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_owner text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_next_action_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_version integer NOT NULL DEFAULT 1;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_crm_version_positive CHECK (crm_version > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leads_crm_queue_idx
  ON leads(crm_stage, crm_priority, crm_next_action_at)
  WHERE crm_stage IS NOT NULL AND crm_stage NOT IN ('PERDIDO', 'GANHO', 'NAO_CONTATAR');
CREATE INDEX IF NOT EXISTS leads_crm_owner_idx
  ON leads(crm_owner, crm_next_action_at)
  WHERE crm_owner IS NOT NULL AND crm_stage NOT IN ('PERDIDO', 'GANHO', 'NAO_CONTATAR');

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  amount numeric(15,2) CHECK (amount IS NULL OR amount >= 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = upper(currency)),
  expected_close_at timestamptz,
  closed_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('GANHO', 'PERDIDO')),
  loss_reason text CHECK (loss_reason IS NULL OR char_length(btrim(loss_reason)) BETWEEN 1 AND 1000),
  owner text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((closed_at IS NULL) = (outcome IS NULL)),
  CHECK (loss_reason IS NULL OR outcome = 'PERDIDO'),
  CHECK (outcome IS DISTINCT FROM 'PERDIDO' OR loss_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS crm_opportunities_lead_updated_idx
  ON crm_opportunities(lead_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS crm_opportunities_expected_close_idx
  ON crm_opportunities(expected_close_at) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  author text NOT NULL CHECK (char_length(btrim(author)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_notes_lead_created_idx ON crm_notes(lead_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS crm_notes_opportunity_created_idx
  ON crm_notes(opportunity_id, created_at DESC, id) WHERE opportunity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  normalized_name text NOT NULL CHECK (normalized_name = lower(btrim(normalized_name))),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_name)
);

CREATE TABLE IF NOT EXISTS crm_lead_tags (
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, tag_id)
);
CREATE INDEX IF NOT EXISTS crm_lead_tags_tag_idx ON crm_lead_tags(tag_id, lead_id);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 5000),
  status commercial_task_status NOT NULL DEFAULT 'PENDENTE',
  priority crm_priority NOT NULL DEFAULT 'MEDIA',
  owner text,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  completion_note text CHECK (completion_note IS NULL OR char_length(completion_note) <= 5000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'CONCLUIDA') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS crm_tasks_lead_due_idx ON crm_tasks(lead_id, status, due_at, id);
CREATE INDEX IF NOT EXISTS crm_tasks_pending_due_idx
  ON crm_tasks(due_at, priority DESC, id) WHERE status = 'PENDENTE';
CREATE INDEX IF NOT EXISTS crm_tasks_owner_pending_idx
  ON crm_tasks(owner, due_at, id) WHERE status = 'PENDENTE' AND owner IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE SET NULL,
  task_id uuid REFERENCES crm_tasks(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 100),
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 200),
  reason text,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_timeline_lead_created_idx
  ON crm_timeline_events(lead_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS crm_timeline_opportunity_idx
  ON crm_timeline_events(opportunity_id, created_at DESC, id DESC) WHERE opportunity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION deny_crm_timeline_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'crm timeline events are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS crm_timeline_immutable ON crm_timeline_events;
CREATE TRIGGER crm_timeline_immutable
BEFORE UPDATE OR DELETE ON crm_timeline_events
FOR EACH ROW EXECUTE FUNCTION deny_crm_timeline_mutation();

CREATE TABLE IF NOT EXISTS crm_idempotency_keys (
  scope text NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint text NOT NULL CHECK (char_length(btrim(payload_fingerprint)) BETWEEN 1 AND 128),
  resource_type text NOT NULL CHECK (char_length(btrim(resource_type)) BETWEEN 1 AND 100),
  resource_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (scope, idempotency_key),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS crm_idempotency_expiry_idx
  ON crm_idempotency_keys(expires_at) WHERE expires_at IS NOT NULL;
