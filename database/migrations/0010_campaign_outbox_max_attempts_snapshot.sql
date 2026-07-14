ALTER TABLE campaign_outbox
  ADD COLUMN IF NOT EXISTS max_attempts_snapshot integer;

-- 0010 is the first release to persist the per-cycle retry limit.  Older
-- rows have no recoverable record of the worker configuration that claimed
-- them, so never read a future worker configuration for a started cycle.
--
-- A legacy active lease has already consumed its current attempt; snapshot
-- its attempt count so expiration reaches a deterministic terminal decision.
-- A legacy started row without an active lease gets exactly one bounded final
-- attempt.  This preserves a retry opportunity without allowing a later
-- worker configuration change to extend the cycle indefinitely.  Rows that
-- have never started deliberately remain NULL and take their snapshot on the
-- first claim.  The NULL predicate makes this backfill safe to re-run.
UPDATE campaign_outbox
SET max_attempts_snapshot = CASE
  WHEN claim_expires_at IS NOT NULL THEN GREATEST(attempts, 1)
  ELSE GREATEST(attempts + 1, 1)
END
WHERE max_attempts_snapshot IS NULL
  AND status = 'PENDING'
  AND (attempts > 0 OR claim_expires_at IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_outbox_max_attempts_snapshot_check'
  ) THEN
    ALTER TABLE campaign_outbox
      ADD CONSTRAINT campaign_outbox_max_attempts_snapshot_check
      CHECK (max_attempts_snapshot IS NULL OR max_attempts_snapshot > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_campaign_outbox_max_attempts_snapshot()
RETURNS trigger AS $$
BEGIN
  IF NEW.dead_letter_cycle = OLD.dead_letter_cycle
     AND OLD.max_attempts_snapshot IS NOT NULL
     AND NEW.max_attempts_snapshot IS DISTINCT FROM OLD.max_attempts_snapshot THEN
    RAISE EXCEPTION 'campaign outbox max attempts snapshot is immutable within a cycle'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.dead_letter_cycle IS DISTINCT FROM OLD.dead_letter_cycle
     AND NEW.max_attempts_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'campaign outbox max attempts snapshot must be reset for a new cycle'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaign_outbox_max_attempts_snapshot_immutable ON campaign_outbox;
CREATE TRIGGER campaign_outbox_max_attempts_snapshot_immutable
  BEFORE UPDATE OF max_attempts_snapshot, dead_letter_cycle ON campaign_outbox
  FOR EACH ROW EXECUTE FUNCTION protect_campaign_outbox_max_attempts_snapshot();
