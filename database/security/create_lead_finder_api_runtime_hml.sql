BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime'
  ) THEN
    RAISE EXCEPTION 'lead_finder_api_runtime must be provisioned before the HML supplement';
  END IF;
END
$$;

-- HML-only manual messaging functions. The generic runtime role script first
-- revokes all function privileges; apply this supplement afterwards when the
-- homologation WhatsApp and restricted email migrations are present.
GRANT EXECUTE ON FUNCTION
  public.create_manual_whatsapp_cloud_send_attempt(uuid, uuid, uuid, uuid, text, text, char, char, char, char, char),
  public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text),
  public.append_manual_whatsapp_cloud_send_event(uuid, text, char, text, smallint, text, text, text, text),
  public.get_manual_whatsapp_cloud_send_scope_status(text),
  public.resolve_manual_email_contact_context(uuid, uuid, uuid, text),
  public.create_manual_email_preparation(uuid, uuid, uuid, text, text, text, character, text, character, jsonb),
  public.resolve_manual_email_preparation_context(uuid, text, boolean),
  public.append_manual_email_open_event(uuid, text, character, text),
  public.get_manual_email_send_attempt(uuid, text),
  public.create_manual_email_send_attempt(uuid, text, character, character, character),
  public.append_manual_email_send_event(uuid, text, text, character, text)
TO lead_finder_api_runtime;

COMMIT;
