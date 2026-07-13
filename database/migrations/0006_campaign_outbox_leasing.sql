ALTER TABLE campaign_outbox
  ADD COLUMN IF NOT EXISTS claim_worker_id text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_outbox_claim_generation_check'
  ) THEN
    ALTER TABLE campaign_outbox
      ADD CONSTRAINT campaign_outbox_claim_generation_check CHECK (claim_generation >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_outbox_claim_tuple_check'
  ) THEN
    ALTER TABLE campaign_outbox
      ADD CONSTRAINT campaign_outbox_claim_tuple_check CHECK (
        (claim_worker_id IS NULL AND claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
        OR
        (claim_worker_id IS NOT NULL AND char_length(btrim(claim_worker_id)) BETWEEN 1 AND 200
          AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
          AND claim_expires_at > claimed_at)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_outbox_terminal_claim_check'
  ) THEN
    ALTER TABLE campaign_outbox
      ADD CONSTRAINT campaign_outbox_terminal_claim_check CHECK (
        status = 'PENDING'
        OR (claim_worker_id IS NULL AND claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS campaign_outbox_claim_queue_idx
  ON campaign_outbox(available_at, claim_expires_at, id)
  WHERE status = 'PENDING';
