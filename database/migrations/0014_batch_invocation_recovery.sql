ALTER TABLE batch_invocations
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE batch_invocations
SET lease_expires_at = COALESCE(lease_expires_at, created_at),
    completed_at = COALESCE(completed_at, created_at)
WHERE lease_expires_at IS NULL OR completed_at IS NULL;

ALTER TABLE batch_invocations
  ALTER COLUMN lease_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS batch_invocations_retryable_idx
  ON batch_invocations (lease_expires_at) WHERE completed_at IS NULL;
