\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON SCHEMA public FROM lead_finder_contact_resolver_runtime;
    EXECUTE format(
      'REVOKE CONNECT ON DATABASE %I FROM lead_finder_contact_resolver_runtime',
      current_database()
    );
    DROP ROLE lead_finder_contact_resolver_runtime;
  END IF;
END $$;
