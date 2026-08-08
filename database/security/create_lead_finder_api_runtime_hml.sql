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

-- The HML Gmail self-test writes only through SECURITY DEFINER functions, but
-- its idempotent replay path must inspect the two append-only audit tables.
-- Keep direct writes denied and expose only SELECT under explicit RLS policies.
GRANT SELECT ON TABLE
  public.operator_email_test_attempts,
  public.operator_email_test_events
TO lead_finder_api_runtime;

ALTER TABLE public.operator_email_test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_email_test_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_attempts_select
  ON public.operator_email_test_attempts;
CREATE POLICY lead_finder_api_runtime_operator_email_attempts_select
  ON public.operator_email_test_attempts
  FOR SELECT TO lead_finder_api_runtime
  USING (true);

DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_events_select
  ON public.operator_email_test_events;
CREATE POLICY lead_finder_api_runtime_operator_email_events_select
  ON public.operator_email_test_events
  FOR SELECT TO lead_finder_api_runtime
  USING (true);

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
