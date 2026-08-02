BEGIN;

DO $$
DECLARE
  parent_role record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    EXECUTE 'CREATE ROLE lead_finder_api_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  ELSE
    EXECUTE 'ALTER ROLE lead_finder_api_runtime WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;

  FOR parent_role IN
    SELECT parent.rolname AS name
    FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    JOIN pg_roles parent ON parent.oid = membership.roleid
    WHERE member_role.rolname = 'lead_finder_api_runtime'
  LOOP
    EXECUTE format('REVOKE %I FROM lead_finder_api_runtime', parent_role.name);
  END LOOP;
END
$$;

ALTER ROLE lead_finder_api_runtime SET search_path = pg_catalog, public;
ALTER ROLE lead_finder_api_runtime SET statement_timeout = '15s';
ALTER ROLE lead_finder_api_runtime SET idle_in_transaction_session_timeout = '15s';

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO lead_finder_api_runtime',
    current_database()
  );
END
$$;

REVOKE ALL ON SCHEMA public FROM lead_finder_api_runtime;
GRANT USAGE ON SCHEMA public TO lead_finder_api_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lead_finder_api_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lead_finder_api_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_api_runtime;

GRANT SELECT ON TABLE public.schema_migrations TO lead_finder_api_runtime;
GRANT SELECT ON TABLE
  public.operator_channel_test_preparations,
  public.operator_channel_test_events
TO lead_finder_api_runtime;

GRANT EXECUTE ON FUNCTION
  public.create_operator_channel_test_preparation(char, char, char, char, char, char),
  public.append_operator_channel_test_event(uuid, text, text, char, char, char),
  public.create_operator_email_test_attempt(char, char, char, char, char, char),
  public.append_operator_email_test_event(uuid, text, char, char, char)
TO lead_finder_api_runtime;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_namespace
    WHERE nspname = 'supabase_migrations'
  ) THEN
    EXECUTE 'REVOKE ALL ON SCHEMA supabase_migrations FROM lead_finder_api_runtime';
    EXECUTE 'GRANT USAGE ON SCHEMA supabase_migrations TO lead_finder_api_runtime';
    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON TABLE supabase_migrations.schema_migrations FROM lead_finder_api_runtime';
      EXECUTE 'GRANT SELECT ON TABLE supabase_migrations.schema_migrations TO lead_finder_api_runtime';
    END IF;
  END IF;
END
$$;

DROP POLICY IF EXISTS lead_finder_api_runtime_schema_migrations_select
  ON public.schema_migrations;
CREATE POLICY lead_finder_api_runtime_schema_migrations_select
  ON public.schema_migrations
  FOR SELECT TO lead_finder_api_runtime
  USING (true);

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_preparations_select
  ON public.operator_channel_test_preparations;
CREATE POLICY lead_finder_api_runtime_operator_preparations_select
  ON public.operator_channel_test_preparations
  FOR SELECT TO lead_finder_api_runtime
  USING (true);

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_events_select
  ON public.operator_channel_test_events;
CREATE POLICY lead_finder_api_runtime_operator_events_select
  ON public.operator_channel_test_events
  FOR SELECT TO lead_finder_api_runtime
  USING (true);

COMMIT;
