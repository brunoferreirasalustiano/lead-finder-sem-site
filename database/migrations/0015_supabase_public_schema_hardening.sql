-- Keep the public schema available to the application database owner while
-- making every Data API role fail closed. No table is intentionally exposed.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  relation record;
  routine record;
  role_name text;
BEGIN
  FOR relation IN
    SELECT c.oid::regclass AS identity, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
  LOOP
    IF relation.relkind IN ('r', 'p') THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', relation.identity);
    END IF;

    EXECUTE format(
      'REVOKE ALL ON %s %s FROM PUBLIC',
      CASE WHEN relation.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      relation.identity
    );

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL ON %s %s FROM %I',
          CASE WHEN relation.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
          relation.identity,
          role_name
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR routine IN
    SELECT
      p.oid::regprocedure AS identity
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public',
      routine.identity
    );
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', routine.identity);

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format(
          'REVOKE ALL ON FUNCTION %s FROM %I',
          routine.identity,
          role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
