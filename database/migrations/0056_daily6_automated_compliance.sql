BEGIN;

-- Automated Daily-6 decisions are distinct from human ownership decisions.
-- Keep the append-only table, but add an explicit machine decision value so a
-- runtime decision can never masquerade as a human review.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.contact_email_business_evidence'::regclass
      AND conname='contact_email_business_evidence_human_decision_check'
  ) THEN
    ALTER TABLE public.contact_email_business_evidence
      DROP CONSTRAINT contact_email_business_evidence_human_decision_check;
  END IF;
  ALTER TABLE public.contact_email_business_evidence
    ADD CONSTRAINT contact_email_business_evidence_human_decision_check
    CHECK (human_decision IN ('APPROVED','REJECTED','AUTOMATED_COMPLIANCE'));

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.pilot_leads'::regclass
      AND conname='pilot_leads_source_check'
  ) THEN
    ALTER TABLE public.pilot_leads DROP CONSTRAINT pilot_leads_source_check;
  END IF;
  ALTER TABLE public.pilot_leads
    ADD CONSTRAINT pilot_leads_source_check
    CHECK (source IN ('SYNTHETIC','MANUAL_IMPORT','COLLECTION','AUTOMATED_DISCOVERY'));
END $$;

-- Automated decisions are not human approvals. Keep the existing pilot review
-- ledger for compatibility, but persist the decision source and evidence
-- provenance explicitly so an automatic decision can never masquerade as a
-- Bruno-reviewed action.
ALTER TABLE public.pilot_reviews
  ADD COLUMN IF NOT EXISTS approval_source text NOT NULL DEFAULT 'HUMAN',
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decision_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.pilot_reviews'::regclass
      AND conname='pilot_reviews_approval_source_check'
  ) THEN
    ALTER TABLE public.pilot_reviews
      ADD CONSTRAINT pilot_reviews_approval_source_check
      CHECK (approval_source IN ('HUMAN','AUTOMATED_COMPLIANCE'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.pilot_reviews'::regclass
      AND conname='pilot_reviews_policy_version_check'
  ) THEN
    ALTER TABLE public.pilot_reviews
      ADD CONSTRAINT pilot_reviews_policy_version_check
      CHECK (policy_version IS NULL OR policy_version='daily6-v1');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.pilot_reviews'::regclass
      AND conname='pilot_reviews_evidence_ids_array_check'
  ) THEN
    ALTER TABLE public.pilot_reviews
      ADD CONSTRAINT pilot_reviews_evidence_ids_array_check
      CHECK (jsonb_typeof(evidence_ids)='array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.pilot_reviews'::regclass
      AND conname='pilot_reviews_decision_reasons_array_check'
  ) THEN
    ALTER TABLE public.pilot_reviews
      ADD CONSTRAINT pilot_reviews_decision_reasons_array_check
      CHECK (jsonb_typeof(decision_reasons)='array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS pilot_reviews_automated_source_idx
  ON public.pilot_reviews(pilot_run_id, lead_id, approval_source, version);

CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_candidates(
  p_city text,
  p_category text,
  p_limit integer
)
RETURNS TABLE(
  lead_id uuid,
  contact_id uuid,
  lead_name text,
  city text,
  category text,
  business_identity_confirmed boolean,
  business_active_pass boolean,
  public_business_email_present boolean,
  email_business_association_pass boolean,
  email_inferred boolean,
  official_site_found boolean,
  site_search_high boolean,
  prior_contact boolean,
  duplicate boolean,
  pending_or_ambiguous_send boolean,
  suppressed boolean,
  hard_bounce boolean,
  opt_out boolean,
  do_not_contact boolean,
  nao_contatar boolean,
  email_channel_allowed boolean,
  current_verified_evidence_required boolean,
  legacy_status_only boolean,
  evidence_ids jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
  WITH candidate AS (
    SELECT
      l.id AS lead_id,
      c.id AS contact_id,
      coalesce(l.name,'empresa') AS lead_name,
      l.city,
      l.category,
      c.normalized_value,
      c.updated_at AS contact_updated_at,
      l.is_blocked,
      l.do_not_contact,
      l.crm_stage,
      l.qualification_status,
      l.website_status,
      EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_IDENTITY'
          AND e.verification_status='VERIFIED'
          AND e.result='BUSINESS_IDENTITY_CONFIRMED'
          AND e.confidence >= 0.800
      ) AS identity_ok,
      EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_ACTIVITY'
          AND e.verification_status='VERIFIED'
          AND e.result='ACTIVE'
          AND e.confidence >= 0.800
      ) AS activity_ok,
      EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.evidence_type='WEBSITE'
          AND e.verification_status='VERIFIED'
          AND e.result='NO_OFFICIAL_SITE_CONFIRMED'
          AND e.confidence >= 0.900
      ) AS website_ok,
      COALESCE((
        SELECT jsonb_agg(e.id ORDER BY e.id)
        FROM public.lead_evidence e
        WHERE e.lead_id=l.id AND e.verification_status='VERIFIED'
          AND e.evidence_type IN ('BUSINESS_IDENTITY','BUSINESS_ACTIVITY','WEBSITE','BUSINESS_EMAIL')
      ), '[]'::jsonb) AS evidence_ids
    FROM public.leads l
    JOIN LATERAL (
      SELECT c0.*
      FROM public.lead_contacts c0
      WHERE c0.lead_id=l.id
        AND upper(c0.type)='EMAIL'
        AND c0.is_valid=true
        AND c0.verified_at IS NOT NULL
        AND btrim(c0.source)<>''
        AND c0.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      ORDER BY c0.updated_at DESC,c0.id
      LIMIT 1
    ) c ON true
    WHERE l.city = p_city
      AND (p_category IS NULL OR l.category = p_category)
      AND NOT l.is_blocked
      AND NOT l.do_not_contact
      AND l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR'
      AND l.website_status='NO_OFFICIAL_SITE_CONFIRMED'
      AND l.qualification_status IN ('SEM_SITE_CONFIRMADO','PENDENTE')
  )
  SELECT
    c.lead_id,c.contact_id,c.lead_name,c.city,c.category,
    c.identity_ok,
    c.activity_ok,
    true,
    EXISTS (
      SELECT 1 FROM public.contact_email_business_evidence e
      WHERE e.contact_id=c.contact_id AND e.lead_id=c.lead_id AND e.channel='EMAIL'
        AND e.ownership='BUSINESS'
        AND e.human_decision IN ('APPROVED','AUTOMATED_COMPLIANCE')
        AND e.origin IN ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD')
    ),
    false,
    false,
    c.website_ok,
    EXISTS (
      SELECT 1 FROM public.pilot_manual_email_send_attempts a
      WHERE a.lead_id=c.lead_id AND a.contact_id=c.contact_id
    ),
    EXISTS (
      SELECT 1 FROM public.daily6_send_ledger d
      WHERE d.lead_id=c.lead_id
    ),
    EXISTS (
      SELECT 1 FROM public.pilot_manual_message_preparations p
      WHERE p.lead_id=c.lead_id AND p.contact_id=c.contact_id
        AND p.channel='EMAIL' AND p.expires_at > clock_timestamp()
    ),
    EXISTS (
      SELECT 1 FROM public.contact_delivery_suppressions s
      WHERE s.lead_id=c.lead_id AND s.contact_id=c.contact_id AND s.channel='EMAIL'
    ),
    EXISTS (
      SELECT 1 FROM public.contact_delivery_suppressions s
      WHERE s.lead_id=c.lead_id AND s.contact_id=c.contact_id
        AND s.channel='EMAIL' AND s.reason='HARD_BOUNCE'
    ),
    EXISTS (
      SELECT 1 FROM public.campaign_opt_outs o
      WHERE o.lead_id=c.lead_id AND (o.channel IS NULL OR o.channel='EMAIL')
    ),
    c.is_blocked,
    c.crm_stage='NAO_CONTATAR',
    true,
    true,
    false,
    c.evidence_ids
  FROM candidate c
  ORDER BY c.contact_updated_at DESC,c.lead_id
  LIMIT greatest(0,least(coalesce(p_limit,0),10));
$$;

-- Extend the canonical resolver for the explicit automated decision source.
-- Manual principals still require APPROVED human business-ownership evidence.
CREATE OR REPLACE FUNCTION public.resolve_narrow_contact(
  p_pilot_run_id uuid,
  p_lead_id uuid,
  p_contact_id uuid,
  p_requested_channel text,
  p_principal text,
  p_action text,
  p_purpose text
)
RETURNS TABLE(
  contact_value text,
  contact_fingerprint char(64),
  contact_source text,
  lead_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_purpose <> 'B2B_PROSPECTION'
    OR p_action NOT IN ('MANUAL_MESSAGE_PREPARE','MANUAL_MESSAGE_REPLAY','MANUAL_MESSAGE_OPEN')
    OR p_requested_channel NOT IN ('WHATSAPP','EMAIL')
    OR p_principal IS NULL
    OR char_length(btrim(p_principal)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'contact resolution denied' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || p_lead_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-messaging-purpose:' || p_lead_id::text || ':B2B_PROSPECTION',0));

  RETURN QUERY
  SELECT c.normalized_value,
    c.contact_resolution_fingerprint::char(64),
    c.source,
    coalesce(l.name,'empresa')
  FROM public.pilot_runs pr
  JOIN public.pilot_leads pl ON pl.pilot_run_id=pr.id
  JOIN public.leads l ON l.id=pl.lead_id
  JOIN public.lead_contacts c ON c.id=p_contact_id AND c.lead_id=l.id
  LEFT JOIN LATERAL (
    SELECT e.ownership,e.origin,e.human_decision
    FROM public.contact_email_business_evidence e
    WHERE e.contact_id=c.id AND e.lead_id=l.id AND e.channel='EMAIL'
    ORDER BY e.version DESC LIMIT 1
  ) ee ON true
  WHERE pr.id=p_pilot_run_id AND l.id=p_lead_id
    AND pr.status='RUNNING'
    AND coalesce((SELECT r.decision='APPROVED' FROM public.pilot_reviews r
      WHERE r.pilot_run_id=pl.pilot_run_id AND r.lead_id=pl.lead_id
      ORDER BY r.version DESC LIMIT 1),false)
    AND NOT l.is_blocked AND NOT l.do_not_contact
    AND l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR'
    AND c.is_valid AND c.verified_at IS NOT NULL AND btrim(c.source)<>''
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_opt_outs o
      WHERE o.lead_id=l.id AND (o.channel IS NULL OR o.channel=p_requested_channel)
    )
    AND (
      (p_requested_channel='WHATSAPP'
        AND upper(c.type) IN ('TELEFONE','PHONE','WHATSAPP')
        AND c.normalized_value ~ '^\+[1-9][0-9]{7,14}$'
        AND EXISTS (
          SELECT 1 FROM public.contact_channel_authorizations a
          WHERE a.contact_id=c.id AND a.lead_id=l.id
            AND a.channel='WHATSAPP' AND a.purpose='B2B_PROSPECTION'
            AND NOT EXISTS (
              SELECT 1 FROM public.contact_channel_authorization_revocations rev
              WHERE rev.authorization_id=a.id AND rev.contact_id=c.id
                AND rev.lead_id=l.id AND rev.purpose='B2B_PROSPECTION'
            )
        ))
      OR
      (p_requested_channel='EMAIL'
        AND upper(c.type)='EMAIL'
        AND c.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        AND ee.ownership='BUSINESS'
        AND (
          ee.human_decision='APPROVED'
          OR (ee.human_decision='AUTOMATED_COMPLIANCE' AND p_principal='daily6-orchestrator')
        )
        AND ee.origin IN ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD'))
    )
  FOR UPDATE OF pr,pl,l,c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact resolution ineligible' USING ERRCODE='P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION lead_finder_internal.prepare_daily6_pilot_context(
  p_batch_id text,
  p_batch_date date,
  p_slot text,
  p_city_id text,
  p_policy_version text,
  p_lead_id uuid,
  p_contact_id uuid,
  p_principal_id text,
  p_evidence_ids jsonb,
  p_decision_reasons jsonb
)
RETURNS TABLE(pilot_run_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  existing_run public.pilot_runs%ROWTYPE;
  run_row public.pilot_runs%ROWTYPE;
  lead_row public.pilot_leads%ROWTYPE;
  current_review public.pilot_reviews%ROWTYPE;
  email_evidence record;
  email_evidence_version integer;
BEGIN
  IF p_policy_version <> 'daily6-v1'
    OR p_batch_id IS NULL OR btrim(p_batch_id)=''
    OR p_slot NOT IN ('09','13','16')
    OR p_city_id IS NULL OR p_city_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR p_principal_id IS NULL OR p_principal_id <> 'daily6-orchestrator'
    OR jsonb_typeof(p_evidence_ids) <> 'array'
    OR jsonb_typeof(p_decision_reasons) <> 'array'
  THEN
    RAISE EXCEPTION 'DAILY6_AUTOMATED_CONTEXT_INVALID' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.daily6_batches(batch_id,batch_date,slot,city_id,policy_version)
  VALUES(p_batch_id,p_batch_date,p_slot,p_city_id,p_policy_version)
  ON CONFLICT (batch_id) DO NOTHING;

  SELECT * INTO existing_run
  FROM public.pilot_runs
  WHERE name='daily6:' || p_batch_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO lead_row
    FROM public.pilot_leads
    WHERE pilot_run_id=existing_run.id AND lead_id=p_lead_id
    FOR UPDATE;
    IF FOUND THEN
      SELECT * INTO current_review
      FROM public.pilot_reviews
      WHERE pilot_run_id=existing_run.id AND lead_id=p_lead_id
      ORDER BY version DESC LIMIT 1
      FOR UPDATE;
      IF current_review.approval_source='AUTOMATED_COMPLIANCE'
        AND current_review.policy_version=p_policy_version
      THEN
        RETURN QUERY SELECT existing_run.id,true;
        RETURN;
      END IF;
      RAISE EXCEPTION 'DAILY6_AUTOMATED_CONTEXT_CONFLICT' USING ERRCODE='23505';
    END IF;
    run_row := existing_run;
  ELSE
    INSERT INTO public.pilot_runs(
      name,region,category,target_lead_count,status,created_by,started_at
    )
    SELECT 'daily6:' || p_batch_id,
      coalesce(l.city,p_city_id),l.category,2,'RUNNING',p_principal_id,clock_timestamp()
    FROM public.leads l
    WHERE l.id=p_lead_id
    RETURNING * INTO run_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DAILY6_LEAD_NOT_FOUND' USING ERRCODE='P0002';
    END IF;
  END IF;

  INSERT INTO public.pilot_leads(pilot_run_id,lead_id,source,added_by)
  VALUES(run_row.id,p_lead_id,'AUTOMATED_DISCOVERY',p_principal_id)
  ON CONFLICT (pilot_run_id,lead_id) DO NOTHING;

  -- Materialize the provider's verified business-email fact in the existing
  -- append-only ownership ledger with an explicit automated decision source.
  -- This is not a human approval and is accepted only by the Daily-6 resolver.
  SELECT e.fingerprint, e.source
  INTO email_evidence
  FROM public.lead_evidence e
  WHERE e.lead_id=p_lead_id
    AND e.evidence_type='BUSINESS_EMAIL'
    AND e.verification_status='VERIFIED'
    AND e.result='EMAIL_BUSINESS_ASSOCIATION_PASS'
    AND e.confidence::numeric >= 0.800
  ORDER BY e.observed_at DESC, e.id DESC
  LIMIT 1;
  IF NOT FOUND OR email_evidence.fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'DAILY6_BUSINESS_EMAIL_EVIDENCE_MISSING' USING ERRCODE='P0001';
  END IF;
  SELECT coalesce(max(e.version),0)+1
  INTO email_evidence_version
  FROM public.contact_email_business_evidence e
  WHERE e.contact_id=p_contact_id;
  INSERT INTO public.contact_email_business_evidence(
    contact_id,lead_id,channel,ownership,origin,evidence_fingerprint,
    human_decision,reviewer_principal_id,version
  ) VALUES (
    p_contact_id,p_lead_id,'EMAIL','BUSINESS','PUBLIC_BUSINESS_SOURCE',
    email_evidence.fingerprint,'AUTOMATED_COMPLIANCE',p_principal_id,email_evidence_version
  )
  ON CONFLICT (contact_id,evidence_fingerprint) DO NOTHING;

  SELECT * INTO current_review
  FROM public.pilot_reviews
  WHERE pilot_run_id=run_row.id AND lead_id=p_lead_id
  ORDER BY version DESC LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF current_review.approval_source='AUTOMATED_COMPLIANCE'
      AND current_review.policy_version=p_policy_version
    THEN
      RETURN QUERY SELECT run_row.id,true;
      RETURN;
    END IF;
    RAISE EXCEPTION 'DAILY6_AUTOMATED_CONTEXT_CONFLICT' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.pilot_reviews(
    pilot_run_id,lead_id,decision,reason,reviewer_principal_id,version,
    approval_source,policy_version,evidence_ids,decision_reasons
  ) VALUES(
    run_row.id,p_lead_id,'APPROVED','Automated compliance gate: daily6-v1',
    p_principal_id,1,'AUTOMATED_COMPLIANCE',p_policy_version,
    p_evidence_ids,p_decision_reasons
  );

  RETURN QUERY SELECT run_row.id,false;
END;
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.ensure_daily6_batch(
  p_batch_id text,
  p_batch_date date,
  p_slot text,
  p_city_id text,
  p_policy_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_policy_version <> 'daily6-v1'
    OR p_batch_id IS NULL OR btrim(p_batch_id)=''
    OR p_batch_date IS NULL
    OR p_slot NOT IN ('09','13','16')
    OR p_city_id IS NULL OR p_city_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  THEN
    RAISE EXCEPTION 'DAILY6_BATCH_CONTRACT_INVALID' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.daily6_batches(batch_id,batch_date,slot,city_id,policy_version)
  VALUES(p_batch_id,p_batch_date,p_slot,p_city_id,p_policy_version)
  ON CONFLICT (batch_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION lead_finder_internal.bump_daily6_batch_metrics(
  p_batch_id text,
  p_discovered integer,
  p_enriched integer,
  p_auto_approved integer,
  p_rejected integer,
  p_ready integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_batch_id IS NULL OR p_discovered < 0 OR p_enriched < 0
    OR p_auto_approved < 0 OR p_rejected < 0 OR p_ready < 0
  THEN
    RAISE EXCEPTION 'DAILY6_METRICS_INVALID' USING ERRCODE='22023';
  END IF;
  UPDATE public.daily6_batches
  SET discovered=greatest(discovered,p_discovered),
      enriched=greatest(enriched,p_enriched),
      auto_approved=greatest(auto_approved,p_auto_approved),
      rejected=greatest(rejected,p_rejected),
      ready=greatest(ready,p_ready),
      updated_at=clock_timestamp()
  WHERE batch_id=p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DAILY6_BATCH_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.prepare_daily6_pilot_context(text,date,text,text,text,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.ensure_daily6_batch(text,date,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lead_finder_internal.bump_daily6_batch_metrics(text,integer,integer,integer,integer,integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    GRANT USAGE ON SCHEMA lead_finder_internal TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer) TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.prepare_daily6_pilot_context(text,date,text,text,text,uuid,uuid,text,jsonb,jsonb) TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.ensure_daily6_batch(text,date,text,text,text) TO lead_finder_api_runtime;
    GRANT EXECUTE ON FUNCTION lead_finder_internal.bump_daily6_batch_metrics(text,integer,integer,integer,integer,integer) TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
