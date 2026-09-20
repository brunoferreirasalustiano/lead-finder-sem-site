BEGIN;

-- A workflow can fail at an immutable safety gate before it claims the
-- dispatch.  That failure is terminal for this dispatch identity and must be
-- recorded without permitting a retry or a successful pre-claim transition.
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
      OR (OLD.status = 'DISPATCH_ACCEPTED' AND NEW.status IN ('WORKFLOW_CLAIMED', 'WORKFLOW_FAILED'))
      OR (OLD.status = 'WORKFLOW_CLAIMED' AND NEW.status IN ('WORKFLOW_SUCCEEDED', 'WORKFLOW_FAILED'))
    ) THEN
      RAISE EXCEPTION 'DAILY6_SCHEDULER_INVALID_TRANSITION:%->%', OLD.status, NEW.status;
    END IF;
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
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
       OR (status IN ('CLAIMED', 'DISPATCH_ACCEPTED') AND p_terminal_status = 'WORKFLOW_FAILED')
     );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.guard_daily6_scheduler_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_discovery_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid, text)
      TO lead_finder_discovery_runtime;
  END IF;
END
$$;

-- Reconcile only the two incident dispatches whose GitHub workflows failed at
-- immutable pre-claim gates on 2026-09-19.  A read-only incident audit found
-- no collection job, batch, or send-ledger row for either identity.  Binding
-- every immutable field prevents this migration from becoming a generic
-- catch-up or retry mechanism.
UPDATE public.daily6_scheduler_dispatches
   SET status = 'WORKFLOW_FAILED'
 WHERE request_identity = '2026-09-19|13|campinas-sp|daily6-v1'
   AND dispatch_nonce = '4359c702-0cc4-43ce-8e2d-6b5fdb609de7'::uuid
   AND scheduled_at = '2026-09-19T16:07:00Z'::timestamptz
   AND status = 'DISPATCH_ACCEPTED';

UPDATE public.daily6_scheduler_dispatches
   SET status = 'WORKFLOW_FAILED'
 WHERE request_identity = '2026-09-19|16|campinas-sp|daily6-v1'
   AND dispatch_nonce = '0615c18f-cf49-4196-89b8-3acff42680d1'::uuid
   AND scheduled_at = '2026-09-19T19:07:00Z'::timestamptz
   AND status = 'DISPATCH_ACCEPTED';

COMMIT;
