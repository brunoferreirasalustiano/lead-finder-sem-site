-- Keep UNCLASSIFIED only for historical rows created before typed failure codes.
-- Runtime writes are restricted by the TypeScript SafeOutboxFailureCode union.
DO $$
BEGIN
  ALTER TABLE campaign_dead_letters
    DROP CONSTRAINT IF EXISTS campaign_dead_letters_error_code_check;

  ALTER TABLE campaign_dead_letters
    ADD CONSTRAINT campaign_dead_letters_error_code_check
    CHECK (
      error_code IN (
        'UNCLASSIFIED',
        'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION',
        'SIMULATED_TIMEOUT_AFTER_CONFIRMATION',
        'SIMULATED_EXECUTION_FAILED',
        'FINAL_LEASE_EXPIRED'
      )
    );
END $$;
