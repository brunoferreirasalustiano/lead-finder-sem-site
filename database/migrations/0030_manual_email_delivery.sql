BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    CREATE ROLE lead_finder_api_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.pilot_manual_email_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preparation_id uuid NOT NULL REFERENCES public.pilot_manual_message_preparations(id),
  pilot_run_id uuid NOT NULL REFERENCES public.pilot_runs(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  contact_id uuid NOT NULL REFERENCES public.lead_contacts(id),
  operator_principal_id text NOT NULL CHECK (btrim(operator_principal_id) <> ''),
  sender_fingerprint char(64) NOT NULL CHECK (sender_fingerprint ~ '^[0-9a-f]{64}$'),
  recipient_fingerprint char(64) NOT NULL CHECK (recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  message_fingerprint char(64) NOT NULL CHECK (message_fingerprint ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('GMAIL_API')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preparation_id)
);

CREATE TABLE IF NOT EXISTS public.pilot_manual_email_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.pilot_manual_email_send_attempts(id),
  event_type text NOT NULL CHECK (event_type IN ('DELIVERED','FAILED','AMBIGUOUS')),
  provider_message_fingerprint char(64) CHECK (provider_message_fingerprint IS NULL OR provider_message_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id)
);

REVOKE ALL ON public.pilot_manual_email_send_attempts, public.pilot_manual_email_send_events FROM PUBLIC;
GRANT SELECT, INSERT ON public.pilot_manual_email_send_attempts, public.pilot_manual_email_send_events TO lead_finder_api_runtime;

ALTER TABLE public.pilot_manual_email_send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_manual_email_send_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_attempts ON public.pilot_manual_email_send_attempts;
CREATE POLICY lead_finder_api_runtime_manual_email_attempts ON public.pilot_manual_email_send_attempts FOR SELECT TO lead_finder_api_runtime USING (true);
DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_attempts_insert ON public.pilot_manual_email_send_attempts;
CREATE POLICY lead_finder_api_runtime_manual_email_attempts_insert ON public.pilot_manual_email_send_attempts FOR INSERT TO lead_finder_api_runtime WITH CHECK (true);
DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_events ON public.pilot_manual_email_send_events;
CREATE POLICY lead_finder_api_runtime_manual_email_events ON public.pilot_manual_email_send_events FOR SELECT TO lead_finder_api_runtime USING (true);
DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_events_insert ON public.pilot_manual_email_send_events;
CREATE POLICY lead_finder_api_runtime_manual_email_events_insert ON public.pilot_manual_email_send_events FOR INSERT TO lead_finder_api_runtime WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.prevent_manual_email_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'manual email audit is append-only'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pilot_manual_email_attempts_append_only ON public.pilot_manual_email_send_attempts;
CREATE TRIGGER pilot_manual_email_attempts_append_only BEFORE UPDATE OR DELETE ON public.pilot_manual_email_send_attempts FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_email_attempt_mutation();
DROP TRIGGER IF EXISTS pilot_manual_email_events_append_only ON public.pilot_manual_email_send_events;
CREATE TRIGGER pilot_manual_email_events_append_only BEFORE UPDATE OR DELETE ON public.pilot_manual_email_send_events FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_email_attempt_mutation();

COMMIT;
