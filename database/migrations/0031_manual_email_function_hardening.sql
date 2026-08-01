BEGIN;

ALTER FUNCTION public.prevent_manual_email_attempt_mutation()
  SET search_path = pg_catalog, public;

COMMIT;
