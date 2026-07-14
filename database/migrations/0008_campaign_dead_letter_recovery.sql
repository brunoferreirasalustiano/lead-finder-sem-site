ALTER TABLE campaign_outbox
  ADD COLUMN IF NOT EXISTS dead_letter_cycle integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_outbox_dead_letter_cycle_check') THEN
    ALTER TABLE campaign_outbox ADD CONSTRAINT campaign_outbox_dead_letter_cycle_check
      CHECK (dead_letter_cycle >= 0);
  END IF;
END $$;

ALTER TABLE campaign_execution_starts
  ADD COLUMN IF NOT EXISTS cycle integer NOT NULL DEFAULT 0;
ALTER TABLE campaign_execution_starts
  DROP CONSTRAINT IF EXISTS campaign_execution_starts_outbox_key,
  DROP CONSTRAINT IF EXISTS campaign_execution_starts_attempt_key;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_execution_starts_cycle_check') THEN
    ALTER TABLE campaign_execution_starts ADD CONSTRAINT campaign_execution_starts_cycle_check CHECK (cycle >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_execution_starts_outbox_cycle_key') THEN
    ALTER TABLE campaign_execution_starts ADD CONSTRAINT campaign_execution_starts_outbox_cycle_key UNIQUE (outbox_id, cycle);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_execution_starts_attempt_cycle_key') THEN
    ALTER TABLE campaign_execution_starts ADD CONSTRAINT campaign_execution_starts_attempt_cycle_key UNIQUE (attempt_id, cycle);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_execution_starts_identity_key') THEN
    ALTER TABLE campaign_execution_starts ADD CONSTRAINT campaign_execution_starts_identity_key UNIQUE (id, outbox_id, cycle);
  END IF;
END $$;

ALTER TABLE campaign_dead_letters
  ADD COLUMN IF NOT EXISTS cycle integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_code text NOT NULL DEFAULT 'UNCLASSIFIED',
  ADD COLUMN IF NOT EXISTS claim_generation integer NOT NULL DEFAULT 0;
ALTER TABLE campaign_dead_letters
  DROP CONSTRAINT IF EXISTS campaign_dead_letters_outbox_id_key,
  DROP CONSTRAINT IF EXISTS campaign_dead_letters_outbox_id_unique;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dead_letters_cycle_check') THEN
    ALTER TABLE campaign_dead_letters ADD CONSTRAINT campaign_dead_letters_cycle_check CHECK (cycle >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dead_letters_claim_generation_check') THEN
    ALTER TABLE campaign_dead_letters ADD CONSTRAINT campaign_dead_letters_claim_generation_check CHECK (claim_generation >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dead_letters_error_code_check') THEN
    ALTER TABLE campaign_dead_letters ADD CONSTRAINT campaign_dead_letters_error_code_check
      CHECK (char_length(btrim(error_code)) BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dead_letters_outbox_cycle_key') THEN
    ALTER TABLE campaign_dead_letters ADD CONSTRAINT campaign_dead_letters_outbox_cycle_key UNIQUE (outbox_id, cycle);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dead_letters_identity_key') THEN
    ALTER TABLE campaign_dead_letters ADD CONSTRAINT campaign_dead_letters_identity_key UNIQUE (id, outbox_id, cycle);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaign_simulated_confirmations (
  execution_id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL,
  cycle integer NOT NULL,
  attempt_id uuid REFERENCES campaign_attempts(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_simulated_confirmations_execution_fkey
    FOREIGN KEY (execution_id, outbox_id, cycle)
    REFERENCES campaign_execution_starts(id, outbox_id, cycle) ON DELETE RESTRICT,
  CONSTRAINT campaign_simulated_confirmations_outbox_cycle_key UNIQUE (outbox_id, cycle),
  CONSTRAINT campaign_simulated_confirmations_cycle_check CHECK (cycle >= 0),
  CONSTRAINT campaign_simulated_confirmations_channel_check CHECK (channel IN ('EMAIL', 'WHATSAPP')),
  CONSTRAINT campaign_simulated_confirmations_timestamps_check CHECK (created_at >= confirmed_at)
);
CREATE INDEX IF NOT EXISTS campaign_simulated_confirmations_confirmed_idx
  ON campaign_simulated_confirmations(confirmed_at, execution_id);

CREATE TABLE IF NOT EXISTS campaign_dead_letter_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dead_letter_id uuid NOT NULL UNIQUE,
  outbox_id uuid NOT NULL REFERENCES campaign_outbox(id) ON DELETE RESTRICT,
  from_cycle integer NOT NULL,
  to_cycle integer NOT NULL,
  actor text NOT NULL CHECK (char_length(btrim(actor)) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  payload_fingerprint char(64) NOT NULL,
  available_at timestamptz NOT NULL,
  recovered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_dead_letter_recoveries_dead_letter_fkey
    FOREIGN KEY (dead_letter_id, outbox_id, from_cycle)
    REFERENCES campaign_dead_letters(id, outbox_id, cycle) ON DELETE RESTRICT,
  CONSTRAINT campaign_dead_letter_recoveries_from_cycle_check CHECK (from_cycle >= 0),
  CONSTRAINT campaign_dead_letter_recoveries_cycle_transition_check CHECK (to_cycle = from_cycle + 1),
  CONSTRAINT campaign_dead_letter_recoveries_timestamps_check CHECK (created_at >= recovered_at)
);
CREATE INDEX IF NOT EXISTS campaign_dead_letter_recoveries_outbox_idx
  ON campaign_dead_letter_recoveries(outbox_id, recovered_at, id);

DROP TRIGGER IF EXISTS campaign_simulated_confirmations_append_only_trigger ON campaign_simulated_confirmations;
CREATE TRIGGER campaign_simulated_confirmations_append_only_trigger
  BEFORE UPDATE OR DELETE ON campaign_simulated_confirmations
  FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();

DROP TRIGGER IF EXISTS campaign_dead_letter_recoveries_append_only_trigger ON campaign_dead_letter_recoveries;
CREATE TRIGGER campaign_dead_letter_recoveries_append_only_trigger
  BEFORE UPDATE OR DELETE ON campaign_dead_letter_recoveries
  FOR EACH ROW EXECUTE FUNCTION protect_campaign_history();
