BEGIN;

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_events_select
  ON public.operator_channel_test_events;
DROP POLICY IF EXISTS lead_finder_api_runtime_operator_preparations_select
  ON public.operator_channel_test_preparations;
DROP POLICY IF EXISTS lead_finder_api_runtime_schema_migrations_select
  ON public.schema_migrations;

DO $$
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
  END IF;
END
$$;

DROP ROLE IF EXISTS lead_finder_api_runtime;

COMMIT;
