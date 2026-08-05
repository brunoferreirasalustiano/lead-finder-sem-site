BEGIN;

-- Migrations establish a deny-all baseline.  Runtime access is installed only
-- by database/security/create_lead_finder_api_runtime.sql.
DROP POLICY IF EXISTS prospecting_runs_runtime_policy
  ON public.prospecting_runs;
DROP POLICY IF EXISTS prospecting_reasons_runtime_policy
  ON public.prospecting_run_rejection_reasons;
DROP POLICY IF EXISTS prospecting_state_runtime_policy
  ON public.prospecting_city_state;
DROP POLICY IF EXISTS prospecting_transitions_runtime_policy
  ON public.prospecting_city_transitions;
DROP POLICY IF EXISTS prospecting_runs_runtime_select
  ON public.prospecting_runs;
DROP POLICY IF EXISTS prospecting_runs_runtime_insert
  ON public.prospecting_runs;
DROP POLICY IF EXISTS prospecting_reasons_runtime_select
  ON public.prospecting_run_rejection_reasons;
DROP POLICY IF EXISTS prospecting_reasons_runtime_insert
  ON public.prospecting_run_rejection_reasons;
DROP POLICY IF EXISTS prospecting_state_runtime_select
  ON public.prospecting_city_state;
DROP POLICY IF EXISTS prospecting_state_runtime_insert
  ON public.prospecting_city_state;
DROP POLICY IF EXISTS prospecting_state_runtime_update
  ON public.prospecting_city_state;
DROP POLICY IF EXISTS prospecting_transitions_runtime_select
  ON public.prospecting_city_transitions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    REVOKE ALL ON TABLE
      public.prospecting_runs,
      public.prospecting_run_rejection_reasons,
      public.prospecting_city_state,
      public.prospecting_city_transitions
    FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION
      public.prospecting_assert_rejection_reason_sum(uuid),
      public.advance_prospecting_city_state(text, text, text, text, uuid, bigint)
    FROM lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
