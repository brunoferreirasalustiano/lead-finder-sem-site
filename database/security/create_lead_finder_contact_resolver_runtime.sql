\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    CREATE ROLE lead_finder_contact_resolver_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE lead_finder_contact_resolver_runtime
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO lead_finder_contact_resolver_runtime',
    current_database()
  );
END $$;
REVOKE ALL ON SCHEMA public FROM lead_finder_contact_resolver_runtime;
GRANT USAGE ON SCHEMA public TO lead_finder_contact_resolver_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM lead_finder_contact_resolver_runtime;
GRANT EXECUTE ON FUNCTION
  public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)
TO lead_finder_contact_resolver_runtime;

DO $$
DECLARE membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role
    FROM pg_auth_members member_record
    JOIN pg_roles granted ON granted.oid=member_record.roleid
    JOIN pg_roles member_role ON member_role.oid=member_record.member
    WHERE member_role.rolname='lead_finder_contact_resolver_runtime'
  LOOP
    EXECUTE format('REVOKE %I FROM lead_finder_contact_resolver_runtime',membership.granted_role);
  END LOOP;
END $$;

COMMIT;
