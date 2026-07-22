-- Harden objects introduced by migration 0016 for the Supabase deny-all model.
-- The application connects directly to PostgreSQL; no public Data API access is intended.

ALTER TABLE public.restore_suppression_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.restore_suppression_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.restore_suppression_runs FROM anon;
REVOKE ALL ON TABLE public.restore_suppression_runs FROM authenticated;

ALTER FUNCTION public.protect_restore_suppression_run()
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.protect_restore_suppression_run() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_restore_suppression_run() FROM anon;
REVOKE ALL ON FUNCTION public.protect_restore_suppression_run() FROM authenticated;

-- Prevent future objects created by the migration owner from inheriting
-- Supabase Data API grants before a later hardening pass can run.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;
