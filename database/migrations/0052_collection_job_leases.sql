-- Bounded one-shot discovery requires recoverable, owner-bound leases.
ALTER TABLE public.collection_jobs
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

UPDATE public.collection_jobs
SET lease_expires_at = updated_at + interval '30 minutes'
WHERE status = 'PROCESSING' AND lease_expires_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_jobs_attempt_count_nonnegative'
      AND conrelid = 'public.collection_jobs'::regclass
  ) THEN
    ALTER TABLE public.collection_jobs
      ADD CONSTRAINT collection_jobs_attempt_count_nonnegative CHECK (attempt_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS collection_jobs_lease_recovery_idx
  ON public.collection_jobs (status, lease_expires_at, created_at);
