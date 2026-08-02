BEGIN;

-- The API currently uses the privileged PostgreSQL connection.  The
-- least-privilege runtime role must not receive direct table access to the
-- append-only email audit tables: the operator-email paths use allowlisted
-- SECURITY DEFINER functions, while manual email delivery remains fail-closed
-- until a dedicated least-privilege write path exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    REVOKE ALL ON TABLE
      public.operator_email_test_attempts,
      public.operator_email_test_events,
      public.pilot_manual_email_send_attempts,
      public.pilot_manual_email_send_events
      FROM lead_finder_api_runtime;

    DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_attempts_select
      ON public.operator_email_test_attempts;
    DROP POLICY IF EXISTS lead_finder_api_runtime_operator_email_events_select
      ON public.operator_email_test_events;
    DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_attempts
      ON public.pilot_manual_email_send_attempts;
    DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_attempts_insert
      ON public.pilot_manual_email_send_attempts;
    DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_events
      ON public.pilot_manual_email_send_events;
    DROP POLICY IF EXISTS lead_finder_api_runtime_manual_email_events_insert
      ON public.pilot_manual_email_send_events;
  END IF;
END
$$;

COMMIT;
