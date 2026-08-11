-- Retries of a scheduled collection must resolve to one durable logical job.
-- Existing rows remain valid with NULL identity; only new scheduler requests
-- are required to provide the versioned identity.
ALTER TABLE public.collection_jobs
  ADD COLUMN IF NOT EXISTS request_identity text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_jobs_request_identity_check'
      AND conrelid = 'public.collection_jobs'::regclass
  ) THEN
    ALTER TABLE public.collection_jobs
      ADD CONSTRAINT collection_jobs_request_identity_check
      CHECK (
        request_identity IS NULL OR
        request_identity ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS collection_jobs_request_identity_uidx
  ON public.collection_jobs (request_identity)
  WHERE request_identity IS NOT NULL;
