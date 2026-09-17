BEGIN;

-- Daily-6 must evaluate the newest append-only business decision for each
-- evidence type. Historical PASS rows must not override a newer inactive,
-- unconfirmed, unknown, or official-site observation.
CREATE INDEX IF NOT EXISTS lead_evidence_daily6_latest_idx
  ON public.lead_evidence(
    lead_id,
    evidence_type,
    observed_at DESC,
    created_at DESC,
    id DESC
  );

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
      COALESCE(
        latest_identity.verification_status='VERIFIED'
        AND latest_identity.result='BUSINESS_IDENTITY_CONFIRMED'
        AND latest_identity.confidence >= 0.800,
        false
      ) AS identity_ok,
      COALESCE(
        latest_activity.verification_status='VERIFIED'
        AND latest_activity.result='ACTIVE'
        AND latest_activity.confidence >= 0.800,
        false
      ) AS activity_ok,
      COALESCE(
        latest_website.verification_status='VERIFIED'
        AND latest_website.result='NO_OFFICIAL_SITE_CONFIRMED'
        AND latest_website.confidence >= 0.900,
        false
      ) AS website_ok,
      to_jsonb(array_remove(ARRAY[
        latest_identity.id,
        latest_activity.id,
        latest_website.id,
        latest_business_email.id
      ]::uuid[], NULL)) AS evidence_ids
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
    LEFT JOIN LATERAL (
      SELECT e.id,e.verification_status,e.result,e.confidence
      FROM public.lead_evidence e
      WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_IDENTITY'
      ORDER BY e.observed_at DESC,e.created_at DESC,e.id DESC
      LIMIT 1
    ) latest_identity ON true
    LEFT JOIN LATERAL (
      SELECT e.id,e.verification_status,e.result,e.confidence
      FROM public.lead_evidence e
      WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_ACTIVITY'
      ORDER BY e.observed_at DESC,e.created_at DESC,e.id DESC
      LIMIT 1
    ) latest_activity ON true
    LEFT JOIN LATERAL (
      SELECT e.id,e.verification_status,e.result,e.confidence
      FROM public.lead_evidence e
      WHERE e.lead_id=l.id AND e.evidence_type='WEBSITE'
      ORDER BY e.observed_at DESC,e.created_at DESC,e.id DESC
      LIMIT 1
    ) latest_website ON true
    LEFT JOIN LATERAL (
      SELECT e.id
      FROM public.lead_evidence e
      WHERE e.lead_id=l.id AND e.evidence_type='BUSINESS_EMAIL'
      ORDER BY e.observed_at DESC,e.created_at DESC,e.id DESC
      LIMIT 1
    ) latest_business_email ON true
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
    COALESCE(
      latest_email.ownership='BUSINESS'
      AND latest_email.human_decision IN ('APPROVED','AUTOMATED_COMPLIANCE')
      AND latest_email.origin IN ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD'),
      false
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
  LEFT JOIN LATERAL (
    SELECT e.ownership,e.origin,e.human_decision
    FROM public.contact_email_business_evidence e
    WHERE e.contact_id=c.contact_id
      AND e.lead_id=c.lead_id
      AND e.channel='EMAIL'
    ORDER BY e.version DESC,e.id DESC
    LIMIT 1
  ) latest_email ON true
  ORDER BY c.contact_updated_at DESC,c.lead_id
  LIMIT greatest(0,least(coalesce(p_limit,0),40));
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_candidates(text,text,integer)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
