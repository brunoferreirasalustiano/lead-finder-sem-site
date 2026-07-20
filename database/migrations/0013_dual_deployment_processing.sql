CREATE TABLE IF NOT EXISTS processor_leadership (
  queue_name text PRIMARY KEY,
  active_source text NOT NULL CHECK (active_source IN ('oracle-vps', 'supabase-render')),
  executor_id text NOT NULL CHECK (length(executor_id) BETWEEN 1 AND 200),
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lease_expires_at > updated_at)
);

CREATE TABLE IF NOT EXISTS processor_leadership_audit (
  id bigserial PRIMARY KEY,
  queue_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('oracle-vps', 'supabase-render')),
  executor_fingerprint text NOT NULL CHECK (executor_fingerprint ~ '^[a-f0-9]{16}$'),
  generation bigint NOT NULL CHECK (generation > 0),
  event text NOT NULL CHECK (event IN ('ACQUIRED', 'RENEWED', 'TAKEN_OVER', 'RELEASED')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS processor_leadership_audit_queue_time_idx
  ON processor_leadership_audit (queue_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS deployment_daily_lead_counters (
  quota_day date PRIMARY KEY,
  count integer NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS deployment_daily_lead_allocations (
  outbox_id uuid NOT NULL REFERENCES campaign_outbox(id) ON DELETE RESTRICT,
  dead_letter_cycle integer NOT NULL CHECK (dead_letter_cycle >= 0),
  quota_day date NOT NULL REFERENCES deployment_daily_lead_counters(quota_day) ON DELETE RESTRICT,
  execution_source text NOT NULL CHECK (execution_source IN ('oracle-vps', 'supabase-render')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outbox_id, dead_letter_cycle)
);
CREATE INDEX IF NOT EXISTS deployment_daily_lead_allocations_day_idx
  ON deployment_daily_lead_allocations (quota_day, created_at);

CREATE TABLE IF NOT EXISTS batch_invocations (
  idempotency_key text PRIMARY KEY CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  execution_source text NOT NULL CHECK (execution_source IN ('oracle-vps', 'supabase-render')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batch_invocations_created_idx ON batch_invocations (created_at);

ALTER TABLE processor_leadership ENABLE ROW LEVEL SECURITY;
ALTER TABLE processor_leadership_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_daily_lead_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_daily_lead_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_invocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON processor_leadership, processor_leadership_audit,
  deployment_daily_lead_counters, deployment_daily_lead_allocations, batch_invocations FROM PUBLIC;
REVOKE ALL ON SEQUENCE processor_leadership_audit_id_seq FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON processor_leadership, processor_leadership_audit, deployment_daily_lead_counters, deployment_daily_lead_allocations, batch_invocations FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE processor_leadership_audit_id_seq FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON processor_leadership, processor_leadership_audit, deployment_daily_lead_counters, deployment_daily_lead_allocations, batch_invocations FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE processor_leadership_audit_id_seq FROM authenticated';
  END IF;
END $$;

COMMENT ON TABLE deployment_daily_lead_counters IS 'UTC daily authority; hard database ceiling of 60 independent of runtime configuration';
