BEGIN;

-- Restricted manual-email functions are intentionally exposed only through
-- SECURITY DEFINER entry points. Earlier migrations revoke the HML runtime
-- role while replacing these definitions; restore the narrow execute allowlist
-- at the end of the migration sequence when that role already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime'
  ) THEN
    GRANT EXECUTE ON FUNCTION
      public.resolve_manual_email_contact_context(uuid, uuid, uuid, text),
      public.create_manual_email_preparation(uuid, uuid, uuid, text, text, text, character, text, character, jsonb),
      public.resolve_manual_email_preparation_context(uuid, text, boolean),
      public.append_manual_email_open_event(uuid, text, character, text),
      public.get_manual_email_send_attempt(uuid, text),
      public.create_manual_email_send_attempt(uuid, text, character, character, character),
      public.append_manual_email_send_event(uuid, text, text, character, text)
    TO lead_finder_api_runtime;
  END IF;
END
$$;

COMMIT;
