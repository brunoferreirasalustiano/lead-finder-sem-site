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
  public.append_manual_email_send_event(uuid, text, text, character, text),
  public.run_hml_suppression_probe(text, boolean)
TO lead_finder_api_runtime;

-- Daily-6 quota enforcement is exposed only through SECURITY DEFINER functions.
-- The runtime receives no direct table grants and cannot bypass reservation,
-- recipient uniqueness, or the durable batch/day limits.
GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_api_runtime;
GRANT EXECUTE ON FUNCTION
  lead_finder_internal.reserve_daily6_send(text, text, uuid, char(64), text),
  lead_finder_internal.finalize_daily6_send(text, text, text, char(64), text),
  lead_finder_internal.list_daily6_candidates(text, text, integer),
  lead_finder_internal.prepare_daily6_pilot_context(text, date, text, text, text, uuid, uuid, text, jsonb, jsonb),
  lead_finder_internal.ensure_daily6_batch(text, date, text, text, text),
  lead_finder_internal.bump_daily6_batch_metrics(text, integer, integer, integer, integer, integer),
  lead_finder_internal.get_daily6_collection_status(text),
  lead_finder_internal.finalize_daily6_batch(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text),
  lead_finder_internal.sync_daily6_batch_from_collection(text),
  lead_finder_internal.enqueue_collection_job(text, jsonb),
  lead_finder_internal.list_daily6_whatsapp_opportunities(text, text, integer),
  lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer)
TO lead_finder_api_runtime;

-- The bounded operator Gmail self-test reserves and replays attempts by reading
-- its two fingerprint-only audit tables before any provider call. Migration
-- 0027 originally granted this read boundary, but the generic runtime reset is
-- intentionally deny-by-default and removes it. Restore only this HML-specific
-- read surface after the reset; no raw recipient or message content is stored.
GRANT SELECT ON TABLE
  public.operator_email_test_attempts,
  public.operator_email_test_events
TO lead_finder_api_runtime;

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

COMMIT;
