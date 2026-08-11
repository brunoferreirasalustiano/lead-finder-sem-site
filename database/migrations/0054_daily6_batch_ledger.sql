-- Durable, bounded pilot ledger. This table records discovery batch state and
-- never contains recipient PII; send identities are opaque fingerprints.
CREATE TABLE IF NOT EXISTS public.daily6_batches (
  batch_id text PRIMARY KEY,
  batch_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('09', '13', '16')),
  city_id text NOT NULL CHECK (city_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  policy_version text NOT NULL CHECK (policy_version = 'daily6-v1'),
  max_sends_per_batch smallint NOT NULL DEFAULT 2 CHECK (max_sends_per_batch = 2),
  max_sends_per_day smallint NOT NULL DEFAULT 6 CHECK (max_sends_per_day = 6),
  discovered integer NOT NULL DEFAULT 0 CHECK (discovered >= 0),
  enriched integer NOT NULL DEFAULT 0 CHECK (enriched >= 0),
  auto_approved integer NOT NULL DEFAULT 0 CHECK (auto_approved >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  ready integer NOT NULL DEFAULT 0 CHECK (ready >= 0),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0 AND sent <= 2),
  delivered integer NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  ambiguous integer NOT NULL DEFAULT 0 CHECK (ambiguous >= 0),
  hard_bounced integer NOT NULL DEFAULT 0 CHECK (hard_bounced >= 0),
  replies integer NOT NULL DEFAULT 0 CHECK (replies >= 0),
  positive_replies integer NOT NULL DEFAULT 0 CHECK (positive_replies >= 0),
  opt_outs integer NOT NULL DEFAULT 0 CHECK (opt_outs >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_date, slot, city_id, policy_version)
);

CREATE TABLE IF NOT EXISTS public.daily6_send_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL REFERENCES public.daily6_batches(batch_id),
  send_identity text NOT NULL UNIQUE,
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  recipient_fingerprint char(64) NOT NULL CHECK (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('RESERVED', 'SENT', 'FAILED', 'AMBIGUOUS')),
  provider_message_fingerprint char(64) CHECK (provider_message_fingerprint IS NULL OR provider_message_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily6_batches_date_idx
  ON public.daily6_batches (batch_date, city_id, slot);
CREATE INDEX IF NOT EXISTS daily6_send_ledger_batch_idx
  ON public.daily6_send_ledger (batch_id, status);

-- These are internal ledgers.  Keep the Supabase Data API deny-all contract;
-- future runtime access must be granted through narrowly scoped server paths.
ALTER TABLE public.daily6_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily6_send_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily6_batches, public.daily6_send_ledger FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.daily6_batches, public.daily6_send_ledger FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.daily6_batches, public.daily6_send_ledger FROM authenticated';
  END IF;
END $$;
