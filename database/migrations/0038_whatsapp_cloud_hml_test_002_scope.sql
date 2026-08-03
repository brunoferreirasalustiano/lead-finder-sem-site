BEGIN;

-- HML_TEST is immutable evidence from the first attempt. HML_TEST_002 is the
-- only additional scope permitted for the separately authorized retry. The
-- existing UNIQUE(send_scope), append-only trigger and transactional advisory
-- lock continue to enforce one claim and one provider request per scope.
ALTER TABLE public.pilot_manual_whatsapp_cloud_send_attempts
  DROP CONSTRAINT IF EXISTS pilot_manual_whatsapp_cloud_send_attempts_send_scope_check;

ALTER TABLE public.pilot_manual_whatsapp_cloud_send_attempts
  ADD CONSTRAINT pilot_manual_whatsapp_cloud_send_attempts_send_scope_check
  CHECK (send_scope IN ('HML_TEST', 'HML_TEST_002'));

COMMIT;
