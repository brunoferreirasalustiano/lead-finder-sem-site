BEGIN;

CREATE TABLE IF NOT EXISTS public.daily6_scheduler_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_identity text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL UNIQUE,
  dispatch_nonce uuid NOT NULL UNIQUE,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN (
    'CLAIMED',
    'DISPATCH_ACCEPTED',
    'DISPATCH_REJECTED',
    'DISPATCH_AMBIGUOUS',
    'WORKFLOW_CLAIMED',
    'WORKFLOW_SUCCEEDED',
    'WORKFLOW_FAILED'
  )),
  github_http_status integer CHECK (github_http_status IS NULL OR github_http_status BETWEEN 100 AND 599),
  error_class text CHECK (error_class IS NULL OR error_class IN (
    'GITHUB_AUTH_REJECTED',
    'GITHUB_REQUEST_REJECTED',
    'GITHUB_UNAVAILABLE',
    'GITHUB_AMBIGUOUS',
    'LEDGER_UPDATE_FAILED'
  )),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (request_identity ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\|(09|13|16)\|campinas-sp\|daily6-v1$')
);

ALTER TABLE public.daily6_scheduler_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily6_scheduler_dispatches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily6_scheduler_dispatches FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.daily6_scheduler_dispatches FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.daily6_scheduler_dispatches FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.daily6_scheduler_dispatches TO service_role;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.guard_daily6_scheduler_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, lead_finder_internal
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DAILY6_SCHEDULER_DISPATCH_DELETE_FORBIDDEN';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.request_identity IS DISTINCT FROM OLD.request_identity
      OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
      OR NEW.dispatch_nonce IS DISTINCT FROM OLD.dispatch_nonce
      OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
      OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
      RAISE EXCEPTION 'DAILY6_SCHEDULER_IDENTITY_IMMUTABLE';
    END IF;

    IF NOT (
      (OLD.status = 'CLAIMED' AND NEW.status IN ('DISPATCH_ACCEPTED', 'DISPATCH_REJECTED', 'DISPATCH_AMBIGUOUS', 'WORKFLOW_CLAIMED', 'WORKFLOW_FAILED'))
      OR (OLD.status = 'DISPATCH_ACCEPTED' AND NEW.status = 'WORKFLOW_CLAIMED')
      OR (OLD.status = 'WORKFLOW_CLAIMED' AND NEW.status IN ('WORKFLOW_SUCCEEDED', 'WORKFLOW_FAILED'))
    ) THEN
      RAISE EXCEPTION 'DAILY6_SCHEDULER_INVALID_TRANSITION:%->%', OLD.status, NEW.status;
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS daily6_scheduler_dispatch_guard ON public.daily6_scheduler_dispatches;
CREATE TRIGGER daily6_scheduler_dispatch_guard
BEFORE UPDATE OR DELETE ON public.daily6_scheduler_dispatches
FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.guard_daily6_scheduler_dispatch();

REVOKE ALL ON FUNCTION lead_finder_internal.guard_daily6_scheduler_dispatch() FROM PUBLIC;

CREATE OR REPLACE FUNCTION lead_finder_internal.claim_daily6_scheduler_dispatch(
  p_request_identity text,
  p_dispatch_nonce uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, lead_finder_internal
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.daily6_scheduler_dispatches
     SET status = 'WORKFLOW_CLAIMED'
   WHERE request_identity = p_request_identity
     AND dispatch_nonce = p_dispatch_nonce
     AND status IN ('CLAIMED', 'DISPATCH_ACCEPTED');
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(
  p_dispatch_nonce uuid,
  p_terminal_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, lead_finder_internal
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF p_terminal_status NOT IN ('WORKFLOW_SUCCEEDED', 'WORKFLOW_FAILED') THEN
    RAISE EXCEPTION 'DAILY6_SCHEDULER_INVALID_TERMINAL_STATUS';
  END IF;

  UPDATE public.daily6_scheduler_dispatches
     SET status = p_terminal_status
   WHERE dispatch_nonce = p_dispatch_nonce
     AND (
       status = 'WORKFLOW_CLAIMED'
       OR (status = 'CLAIMED' AND p_terminal_status = 'WORKFLOW_FAILED')
     );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.claim_daily6_scheduler_dispatch(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_discovery_runtime') THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.claim_daily6_scheduler_dispatch(text, uuid)
      TO lead_finder_discovery_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

COMMIT;
