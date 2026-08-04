BEGIN;

-- Read-only preflight for the fixed, server-side HML Cloud send scopes. The
-- runtime receives only a three-value status and never receives table rows,
-- fingerprints, preparation ids, or contact data.
CREATE OR REPLACE FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(
  p_send_scope text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_send_scope IS NULL OR p_send_scope NOT IN ('HML_TEST', 'HML_TEST_002') THEN 'UNKNOWN'
    WHEN EXISTS (
      SELECT 1
      FROM public.pilot_manual_whatsapp_cloud_send_attempts
      WHERE send_scope = p_send_scope
    ) THEN 'CONSUMED'
    ELSE 'AVAILABLE'
  END;
$$;

REVOKE ALL ON FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(text) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.get_manual_whatsapp_cloud_send_scope_status(text) TO lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
