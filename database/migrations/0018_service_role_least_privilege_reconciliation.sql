-- Reconcile environments that received the emergency 0017 hardening before
-- the final least-privilege service_role contract was versioned.
-- Fresh environments already converge to this state through migration 0017;
-- this migration is intentionally idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.restore_suppression_runs FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.restore_suppression_runs TO service_role';

    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO service_role';
  END IF;
END $$;
