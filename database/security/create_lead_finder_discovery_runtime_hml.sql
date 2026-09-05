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

DO $$
BEGIN
  IF to_regprocedure('lead_finder_internal.claim_daily6_scheduler_dispatch(text,uuid)') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.claim_daily6_scheduler_dispatch(text, uuid)
      TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

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
GRANT UPDATE (city,state)
  ON TABLE public.leads
TO lead_finder_discovery_runtime;
GRANT UPDATE (original_value,source,confidence,verified_at,is_valid,updated_at)
  ON TABLE public.lead_contacts
TO lead_finder_discovery_runtime;

DO $$
BEGIN
  IF to_regprocedure('lead_finder_internal.sync_daily6_batch_from_collection(text)') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

-- RLS is a required boundary for this role. Fail closed if any repository
-- table was provisioned without RLS instead of silently widening access.
DO $$
DECLARE
  table_name text;
  rls_enabled boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations', 'collection_jobs', 'leads', 'lead_contacts', 'lead_evidence'
  ] LOOP
    SELECT c.relrowsecurity
      INTO rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = table_name;
    IF rls_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'DISCOVERY_RLS_REQUIRED:%', table_name;
    END IF;
  END LOOP;
END
$$;

-- Policies are exclusive to this role. USING/WITH CHECK true is intentionally
-- bounded by the table/column grants above and by the role's NOBYPASSRLS
-- attribute; no other role receives these policies.
DROP POLICY IF EXISTS lead_finder_discovery_runtime_schema_migrations_select ON public.schema_migrations;
CREATE POLICY lead_finder_discovery_runtime_schema_migrations_select
  ON public.schema_migrations FOR SELECT TO lead_finder_discovery_runtime
  USING (true);

DROP POLICY IF EXISTS lead_finder_discovery_runtime_collection_jobs_select ON public.collection_jobs;
CREATE POLICY lead_finder_discovery_runtime_collection_jobs_select
  ON public.collection_jobs FOR SELECT TO lead_finder_discovery_runtime
  USING (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_collection_jobs_insert ON public.collection_jobs;
CREATE POLICY lead_finder_discovery_runtime_collection_jobs_insert
  ON public.collection_jobs FOR INSERT TO lead_finder_discovery_runtime
  WITH CHECK (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_collection_jobs_update ON public.collection_jobs;
CREATE POLICY lead_finder_discovery_runtime_collection_jobs_update
  ON public.collection_jobs FOR UPDATE TO lead_finder_discovery_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lead_finder_discovery_runtime_leads_select ON public.leads;
CREATE POLICY lead_finder_discovery_runtime_leads_select
  ON public.leads FOR SELECT TO lead_finder_discovery_runtime
  USING (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_leads_insert ON public.leads;
CREATE POLICY lead_finder_discovery_runtime_leads_insert
  ON public.leads FOR INSERT TO lead_finder_discovery_runtime
  WITH CHECK (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_leads_update ON public.leads;
CREATE POLICY lead_finder_discovery_runtime_leads_update
  ON public.leads FOR UPDATE TO lead_finder_discovery_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lead_finder_discovery_runtime_lead_contacts_select ON public.lead_contacts;
CREATE POLICY lead_finder_discovery_runtime_lead_contacts_select
  ON public.lead_contacts FOR SELECT TO lead_finder_discovery_runtime
  USING (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_lead_contacts_insert ON public.lead_contacts;
CREATE POLICY lead_finder_discovery_runtime_lead_contacts_insert
  ON public.lead_contacts FOR INSERT TO lead_finder_discovery_runtime
  WITH CHECK (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_lead_contacts_update ON public.lead_contacts;
CREATE POLICY lead_finder_discovery_runtime_lead_contacts_update
  ON public.lead_contacts FOR UPDATE TO lead_finder_discovery_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lead_finder_discovery_runtime_lead_evidence_select ON public.lead_evidence;
CREATE POLICY lead_finder_discovery_runtime_lead_evidence_select
  ON public.lead_evidence FOR SELECT TO lead_finder_discovery_runtime
  USING (true);
DROP POLICY IF EXISTS lead_finder_discovery_runtime_lead_evidence_insert ON public.lead_evidence;
CREATE POLICY lead_finder_discovery_runtime_lead_evidence_insert
  ON public.lead_evidence FOR INSERT TO lead_finder_discovery_runtime
  WITH CHECK (true);

COMMIT;
