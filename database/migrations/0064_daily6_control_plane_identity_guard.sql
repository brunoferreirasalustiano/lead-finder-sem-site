BEGIN;

-- The GitHub control plane uses the least-privileged discovery role.  Keep
-- daily6_batches deny-all and expose only an opaque identity existence check
-- through a SECURITY DEFINER boundary owned by the migration administrator.
CREATE SCHEMA IF NOT EXISTS lead_finder_internal;
REVOKE ALL ON SCHEMA lead_finder_internal FROM PUBLIC;

CREATE OR REPLACE FUNCTION lead_finder_internal.daily6_batch_identity_exists(
  p_batch_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_batch_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[|](09|13|16)[|][a-z0-9]+(-[a-z0-9]+)*[|]daily6-v1$'
      THEN EXISTS (
        SELECT 1
        FROM public.daily6_batches
        WHERE batch_id = p_batch_id
      )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.daily6_batch_identity_exists(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_discovery_runtime'
  ) THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.daily6_batch_identity_exists(text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

COMMIT;
