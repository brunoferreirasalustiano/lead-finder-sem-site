BEGIN;

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_events_select
  ON public.operator_email_test_events;
DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_attempts_select
  ON public.operator_email_test_attempts;
DROP POLICY IF EXISTS lead_finder_api_runtime_operator_events_select
  ON public.operator_channel_test_events;
DROP POLICY IF EXISTS lead_finder_api_runtime_operator_preparations_select
  ON public.operator_channel_test_preparations;
DROP POLICY IF EXISTS lead_finder_api_runtime_schema_migrations_select
  ON public.schema_migrations;

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
DECLARE
  member_role record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    REVOKE ALL ON SCHEMA public FROM lead_finder_api_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lead_finder_api_runtime;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lead_finder_api_runtime;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_api_runtime;

    IF EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_migrations'
    ) THEN
      EXECUTE 'REVOKE ALL ON SCHEMA supabase_migrations FROM lead_finder_api_runtime';
      IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON TABLE supabase_migrations.schema_migrations FROM lead_finder_api_runtime';
      END IF;
    END IF;

    EXECUTE format(
      'REVOKE CONNECT ON DATABASE %I FROM lead_finder_api_runtime',
      current_database()
    );

    FOR member_role IN
      SELECT member.rolname AS name
      FROM pg_auth_members membership
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
      WHERE granted_role.rolname = 'lead_finder_api_runtime'
    LOOP
      EXECUTE format('REVOKE lead_finder_api_runtime FROM %I', member_role.name);
    END LOOP;
  END IF;
END
$$;

DROP ROLE IF EXISTS lead_finder_api_runtime;

COMMIT;
