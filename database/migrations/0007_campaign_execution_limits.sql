CREATE TABLE IF NOT EXISTS campaign_daily_channel_counters (
  channel text NOT NULL,
  quota_day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_daily_channel_counters_pkey PRIMARY KEY (channel, quota_day),
  CONSTRAINT campaign_daily_channel_counters_channel_check CHECK (channel IN ('EMAIL', 'WHATSAPP')),
  CONSTRAINT campaign_daily_channel_counters_count_check CHECK (count >= 0),
  CONSTRAINT campaign_daily_channel_counters_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS campaign_channel_runtime (
  channel text PRIMARY KEY,
  next_available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_channel_runtime_channel_check CHECK (channel IN ('EMAIL', 'WHATSAPP')),
  CONSTRAINT campaign_channel_runtime_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS campaign_execution_starts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES campaign_outbox(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES campaign_attempts(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  quota_day date NOT NULL,
  claim_generation integer NOT NULL,
  started_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_execution_starts_outbox_attempt_key UNIQUE (outbox_id, attempt_id),
  CONSTRAINT campaign_execution_starts_channel_check CHECK (channel IN ('EMAIL', 'WHATSAPP')),
  CONSTRAINT campaign_execution_starts_claim_generation_check CHECK (claim_generation >= 0),
  CONSTRAINT campaign_execution_starts_quota_day_check CHECK (quota_day = (started_at AT TIME ZONE 'UTC')::date),
  CONSTRAINT campaign_execution_starts_timestamps_check CHECK (created_at >= started_at)
);

CREATE INDEX IF NOT EXISTS campaign_execution_starts_channel_started_idx
  ON campaign_execution_starts(channel, started_at, id);

CREATE OR REPLACE FUNCTION reject_campaign_execution_start_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'campaign_execution_starts is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS campaign_execution_starts_append_only_trigger ON campaign_execution_starts;
CREATE TRIGGER campaign_execution_starts_append_only_trigger
  BEFORE UPDATE OR DELETE ON campaign_execution_starts
  FOR EACH ROW
  EXECUTE FUNCTION reject_campaign_execution_start_mutation();
