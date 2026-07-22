-- Manual messaging history is append-only. Migration 0018 intentionally grants
-- service_role SELECT/INSERT/UPDATE on future public tables, so the tables added
-- by migration 0019 inherit UPDATE. Reconcile these objects to their narrower
-- contract after creation.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE
        public.contact_channel_authorizations,
        public.contact_email_business_evidence,
        public.pilot_manual_message_preparations,
        public.pilot_manual_message_events
      FROM service_role;

    GRANT SELECT, INSERT
      ON TABLE
        public.contact_channel_authorizations,
        public.contact_email_business_evidence,
        public.pilot_manual_message_preparations,
        public.pilot_manual_message_events
      TO service_role;
  END IF;
END
$$;
