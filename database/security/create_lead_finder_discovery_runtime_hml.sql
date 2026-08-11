BEGIN;

-- HML-only provisioning for the GitHub one-shot discovery worker.
-- Apply with an administrator outside the application runtime. The password
-- must be provisioned through the host secret manager and is never generated
-- or printed by this script.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_discovery_runtime') THEN
    EXECUTE 'CREATE ROLE lead_finder_discovery_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  ELSE
    EXECUTE 'ALTER ROLE lead_finder_discovery_runtime WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN
    EXECUTE 'GRANT lead_finder_discovery_runtime TO postgres';
  END IF;
END
$$;

ALTER ROLE lead_finder_discovery_runtime SET search_path=pg_catalog,public;
ALTER ROLE lead_finder_discovery_runtime SET statement_timeout='30s';
ALTER ROLE lead_finder_discovery_runtime SET idle_in_transaction_session_timeout='30s';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lead_finder_discovery_runtime', current_database());
END
$$;

REVOKE ALL ON SCHEMA public FROM lead_finder_discovery_runtime;
GRANT USAGE ON SCHEMA public TO lead_finder_discovery_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lead_finder_discovery_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lead_finder_discovery_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_discovery_runtime;

-- The worker uses the typed repository for these tables only. It receives no
-- access to delivery, campaign, suppression-ledger, or Gmail tables.
GRANT SELECT ON TABLE
  public.schema_migrations,
  public.collection_jobs,
  public.leads,
  public.lead_contacts,
  public.lead_evidence
TO lead_finder_discovery_runtime;
GRANT INSERT ON TABLE
  public.collection_jobs,
  public.leads,
  public.lead_contacts,
  public.lead_evidence
TO lead_finder_discovery_runtime;
GRANT UPDATE (status,error,lease_token,lease_expires_at,attempt_count,updated_at)
  ON TABLE public.collection_jobs
TO lead_finder_discovery_runtime;
GRANT UPDATE (status,website_status,updated_at)
  ON TABLE public.leads
TO lead_finder_discovery_runtime;
GRANT UPDATE (original_value,source,confidence,verified_at,is_valid,updated_at)
  ON TABLE public.lead_contacts
TO lead_finder_discovery_runtime;

-- RLS is intentionally not bypassed. If a hosted project has RLS enabled on
-- these repository tables, the administrator must add equivalent, reviewed
-- role policies before provisioning the secret; this script fails closed by
-- not creating permissive policies automatically.

COMMIT;
