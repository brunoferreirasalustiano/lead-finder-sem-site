BEGIN;

-- OSM data is an observation, not proof that a website is owned by the
-- business or that no website exists. New collection rows remain UNKNOWN;
-- only rows with an explicit legacy SEM_SITE_CONFIRMADO decision are
-- backfilled below for compatibility with the pre-existing qualification.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website_status text NOT NULL DEFAULT 'UNKNOWN';

-- Backward compatibility only: an explicit legacy qualification decision is
-- retained as a confirmed state. New collection rows remain UNKNOWN until
-- enrichment evidence changes them.
UPDATE public.leads
SET website_status='NO_OFFICIAL_SITE_CONFIRMED'
WHERE website_status='UNKNOWN'
  AND qualification_status='SEM_SITE_CONFIRMADO';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.leads'::regclass
      AND conname='leads_website_status_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_website_status_check
      CHECK (website_status IN ('UNKNOWN','OFFICIAL_SITE_FOUND','NO_OFFICIAL_SITE_CONFIRMED'));
  END IF;
END $$;

ALTER TABLE public.lead_evidence
  ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'OBSERVED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.lead_evidence'::regclass
      AND conname='lead_evidence_type_check'
  ) THEN
    ALTER TABLE public.lead_evidence
      ADD CONSTRAINT lead_evidence_type_check
      CHECK (char_length(btrim(evidence_type)) BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.lead_evidence'::regclass
      AND conname='lead_evidence_verification_status_check'
  ) THEN
    ALTER TABLE public.lead_evidence
      ADD CONSTRAINT lead_evidence_verification_status_check
      CHECK (verification_status IN ('VERIFIED','OBSERVED','UNVERIFIED','REJECTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_website_status_idx
  ON public.leads(website_status, city, category);
CREATE INDEX IF NOT EXISTS lead_evidence_type_status_idx
  ON public.lead_evidence(lead_id, evidence_type, verification_status, observed_at DESC);

COMMIT;
