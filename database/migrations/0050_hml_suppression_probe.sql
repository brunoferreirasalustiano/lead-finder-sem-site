BEGIN;

-- The HML probe is a single, least-privilege database operation.  It owns the
-- fixture transaction so the API runtime never needs direct table or resolver
-- privileges, and it cannot accept an arbitrary recipient.
CREATE OR REPLACE FUNCTION public.run_hml_suppression_probe(
  p_operator_principal_id text,
  p_inject_failure boolean DEFAULT false
)
RETURNS TABLE(
  suppression_matched boolean,
  send_eligible boolean,
  provider_calls integer,
  fixture_rolled_back boolean,
  fixture_rows_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_lead_id uuid := extensions.gen_random_uuid();
  v_contact_id uuid := extensions.gen_random_uuid();
  v_pilot_run_id uuid := extensions.gen_random_uuid();
  v_recipient text := 'lfb-hml-suppression-' || replace(v_lead_id::text, '-', '') || '@example.invalid';
  v_event_fingerprint char(64);
  v_evidence_fingerprint char(64);
  v_remaining integer := 0;
BEGIN
  IF p_operator_principal_id IS NULL
    OR char_length(btrim(p_operator_principal_id)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'HML suppression probe principal is invalid' USING ERRCODE='22023';
  END IF;

  v_event_fingerprint := encode(
    extensions.digest(convert_to('hml-suppression-probe:' || v_pilot_run_id::text, 'UTF8'), 'sha256'),
    'hex'
  )::char(64);
  v_evidence_fingerprint := encode(
    extensions.digest(convert_to('hml-suppression-evidence:' || v_contact_id::text, 'UTF8'), 'sha256'),
    'hex'
  )::char(64);

  -- An exception block is a PostgreSQL savepoint.  The synthetic ledger event,
  -- identity, lead, contact, review and evidence are all rolled back together.
  BEGIN
    PERFORM 1 FROM public.record_precontact_email_delivery_suppression(
      v_recipient, 'INVALID_CONTACT', 'HML_SUPPRESSION_PROBE',
      v_event_fingerprint, clock_timestamp()
    );
    INSERT INTO public.leads(
      id,osm_type,osm_id,name,category,score,status,qualification_status,
      is_blocked,do_not_contact
    ) VALUES (
      v_lead_id,'hml-suppression-probe',v_pilot_run_id::text,
      'HML suppression synthetic fixture','HML_TEST',0,
      'SEM_SITE_CADASTRADO','SEM_SITE_CONFIRMADO',false,false
    );
    INSERT INTO public.lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid
    ) VALUES (
      v_contact_id,v_lead_id,'EMAIL',v_recipient,v_recipient,
      'HML_SUPPRESSION_PROBE',1.0,clock_timestamp(),true
    );
    INSERT INTO public.pilot_runs(
      id,name,region,category,target_lead_count,status,created_by,started_at
    ) VALUES (
      v_pilot_run_id,'HML suppression probe','HML','HML_TEST',1,
      'RUNNING',p_operator_principal_id,clock_timestamp()
    );
    INSERT INTO public.pilot_leads(pilot_run_id,lead_id,source,added_by)
      VALUES (v_pilot_run_id,v_lead_id,'SYNTHETIC',p_operator_principal_id);
    INSERT INTO public.pilot_reviews(
      pilot_run_id,lead_id,decision,reason,reviewer_principal_id,version
    ) VALUES (
      v_pilot_run_id,v_lead_id,'APPROVED','HML suppression probe only',
      p_operator_principal_id,1
    );
    INSERT INTO public.contact_email_business_evidence(
      contact_id,lead_id,ownership,origin,evidence_fingerprint,
      human_decision,reviewer_principal_id,version
    ) VALUES (
      v_contact_id,v_lead_id,'BUSINESS','PUBLIC_BUSINESS_SOURCE',
      v_evidence_fingerprint,'APPROVED',p_operator_principal_id,1
    );

    IF p_inject_failure THEN
      RAISE EXCEPTION 'HML_SUPPRESSION_PROBE_INJECTED_FAILURE' USING ERRCODE='P0001';
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.email_precontact_delivery_suppressions
      WHERE event_fingerprint=v_event_fingerprint
    ) INTO suppression_matched;
    IF NOT suppression_matched THEN
      RAISE EXCEPTION 'HML suppression probe match missing' USING ERRCODE='55000';
    END IF;

    send_eligible := true;
    BEGIN
      PERFORM 1 FROM public.resolve_narrow_contact(
        v_pilot_run_id,v_lead_id,v_contact_id,'EMAIL',p_operator_principal_id,
        'MANUAL_MESSAGE_PREPARE','B2B_PROSPECTION'
      );
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      send_eligible := false;
    END;
    IF send_eligible THEN
      RAISE EXCEPTION 'HML suppression guard did not block' USING ERRCODE='55000';
    END IF;

    provider_calls := 0;
    RAISE EXCEPTION 'HML_SUPPRESSION_PROBE_ROLLBACK' USING ERRCODE='P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT IN ('HML_SUPPRESSION_PROBE_ROLLBACK') THEN
      RAISE;
    END IF;
  END;

  SELECT (
    (SELECT count(*) FROM public.leads WHERE id=v_lead_id) +
    (SELECT count(*) FROM public.lead_contacts WHERE id=v_contact_id) +
    (SELECT count(*) FROM public.pilot_runs WHERE id=v_pilot_run_id) +
    (SELECT count(*) FROM public.pilot_leads WHERE pilot_run_id=v_pilot_run_id AND lead_id=v_lead_id) +
    (SELECT count(*) FROM public.pilot_reviews WHERE pilot_run_id=v_pilot_run_id AND lead_id=v_lead_id) +
    (SELECT count(*) FROM public.contact_email_business_evidence WHERE contact_id=v_contact_id AND lead_id=v_lead_id) +
    (SELECT count(*) FROM public.email_precontact_delivery_suppressions WHERE event_fingerprint=v_event_fingerprint)
  )::int INTO v_remaining;
  fixture_rows_remaining := v_remaining;
  fixture_rolled_back := v_remaining = 0;
  IF NOT fixture_rolled_back THEN
    RAISE EXCEPTION 'HML suppression probe fixture persisted' USING ERRCODE='55000';
  END IF;
  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.run_hml_suppression_probe(text,boolean) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.run_hml_suppression_probe(text,boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.run_hml_suppression_probe(text,boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.run_hml_suppression_probe(text,boolean) FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON FUNCTION public.run_hml_suppression_probe(text,boolean)
      FROM lead_finder_contact_resolver_runtime;
  END IF;
END $$;

COMMIT;
