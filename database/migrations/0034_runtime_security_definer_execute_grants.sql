BEGIN;

-- Reconcile the narrow function allowlist after migration 0032 removed direct
-- table access from the runtime role. Every signature is explicit so overloads
-- cannot receive an unintended grant.
REVOKE EXECUTE ON FUNCTION
  public.create_operator_channel_test_preparation(char, char, char, char, char, char),
  public.append_operator_channel_test_event(uuid, text, text, char, char, char),
  public.create_operator_email_test_attempt(char, char, char, char, char, char),
  public.append_operator_email_test_event(uuid, text, char, char, char)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION
      public.create_operator_channel_test_preparation(char, char, char, char, char, char),
      public.append_operator_channel_test_event(uuid, text, text, char, char, char),
      public.create_operator_email_test_attempt(char, char, char, char, char, char),
      public.append_operator_email_test_event(uuid, text, char, char, char)
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION
      public.create_operator_channel_test_preparation(char, char, char, char, char, char),
      public.append_operator_channel_test_event(uuid, text, text, char, char, char),
      public.create_operator_email_test_attempt(char, char, char, char, char, char),
      public.append_operator_email_test_event(uuid, text, char, char, char)
    FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION
      public.create_operator_channel_test_preparation(char, char, char, char, char, char),
      public.append_operator_channel_test_event(uuid, text, text, char, char, char),
      public.create_operator_email_test_attempt(char, char, char, char, char, char),
      public.append_operator_email_test_event(uuid, text, char, char, char)
    TO lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
