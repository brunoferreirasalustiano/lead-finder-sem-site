ALTER TABLE campaign_outbox
  ADD COLUMN IF NOT EXISTS max_attempts_snapshot integer;

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
