BEGIN;

-- Read-only manual-review funnel for public WhatsApp opportunities. This is
-- intentionally separate from the Daily-6 send resolver: no batch, lease,
-- preparation, ledger, provider call, or message is created here.
CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities(
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
  whatsapp_value text,
  whatsapp_source text,
  whatsapp_evidence text,
  website_status text,
  qualification_status text,
  business_identity_confirmed boolean,
  business_active_pass boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH candidate AS (
    SELECT
      l.id AS lead_id,
      c.contact_id,
      left(l.name, 200) AS lead_name,
      l.city,
      l.category,
      c.whatsapp_value,
      c.whatsapp_source,
      c.whatsapp_evidence,
      l.website_status,
      l.qualification_status,
      EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id = l.id
          AND e.evidence_type = 'BUSINESS_IDENTITY'
          AND e.verification_status = 'VERIFIED'
          AND e.result = 'BUSINESS_IDENTITY_CONFIRMED'
          AND e.confidence >= 0.800
      ) AS business_identity_confirmed,
      EXISTS (
        SELECT 1 FROM public.lead_evidence e
        WHERE e.lead_id = l.id
          AND e.evidence_type = 'BUSINESS_ACTIVITY'
          AND e.verification_status = 'VERIFIED'
          AND e.result = 'ACTIVE'
          AND e.confidence >= 0.800
      ) AS business_active_pass
    FROM public.leads l
    JOIN LATERAL (
      SELECT c0.id AS contact_id,
             c0.normalized_value AS whatsapp_value,
             left(c0.source, 64) AS whatsapp_source,
             CASE
               WHEN nullif(btrim(l.whatsapp), '') IS NOT NULL
                 AND regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
                     = regexp_replace(c0.normalized_value, '[^0-9]', '', 'g')
               THEN 'LEAD_WHATSAPP_FIELD'
               ELSE 'POSSIBLE_WHATSAPP_FLAG'
             END AS whatsapp_evidence,
             CASE
               WHEN nullif(btrim(l.whatsapp), '') IS NOT NULL
                 AND regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
                     = regexp_replace(c0.normalized_value, '[^0-9]', '', 'g')
               THEN 2
               ELSE 1
             END AS priority
      FROM public.lead_contacts c0
      WHERE c0.lead_id = l.id
        AND upper(c0.type) = 'TELEFONE'
        AND c0.is_valid = true
        AND c0.verified_at IS NOT NULL
        AND btrim(c0.source) <> ''
        AND c0.normalized_value ~ '^\+[1-9][0-9]{7,14}$'
        AND (
          c0.possible_whatsapp = true
          OR (
            nullif(btrim(l.whatsapp), '') IS NOT NULL
            AND regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
                = regexp_replace(c0.normalized_value, '[^0-9]', '', 'g')
          )
        )
      UNION ALL
      SELECT NULL::uuid AS contact_id,
             CASE
               WHEN regexp_replace(l.whatsapp, '[^0-9]', '', 'g') ~ '^55[1-9][0-9]{9,10}$'
                 THEN '+' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
               WHEN regexp_replace(l.whatsapp, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{9,10}$'
                 THEN '+55' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
               ELSE NULL
             END AS whatsapp_value,
             'LEAD_WHATSAPP_FIELD' AS whatsapp_source,
             'LEAD_WHATSAPP_FIELD' AS whatsapp_evidence,
             0 AS priority
      WHERE nullif(btrim(l.whatsapp), '') IS NOT NULL
      ORDER BY priority DESC
      LIMIT 1
    ) c ON true
    WHERE l.city = p_city
      AND (p_category IS NULL OR l.category = p_category)
      AND NOT l.is_blocked
      AND NOT l.is_closed
      AND c.whatsapp_value IS NOT NULL
      AND NOT l.do_not_contact
      AND l.crm_stage IS DISTINCT FROM 'NAO_CONTATAR'
      AND nullif(btrim(l.website), '') IS NULL
      AND coalesce(l.website_status, 'UNKNOWN') <> 'OFFICIAL_SITE_FOUND'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_evidence website_evidence
        WHERE website_evidence.lead_id = l.id
          AND website_evidence.evidence_type = 'WEBSITE'
          AND website_evidence.verification_status = 'VERIFIED'
          AND website_evidence.result = 'OFFICIAL_SITE_FOUND'
          AND website_evidence.confidence >= 0.800
      )
      -- This report is for WhatsApp-only opportunities; a verified email
      -- contact belongs to the email funnel instead.
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_contacts email_contact
        WHERE email_contact.lead_id = l.id
          AND upper(email_contact.type) = 'EMAIL'
          AND email_contact.is_valid = true
          AND email_contact.verified_at IS NOT NULL
          AND btrim(email_contact.source) <> ''
      )
      -- A global opt-out or WhatsApp opt-out is always a hard blocker.
      AND NOT EXISTS (
        SELECT 1 FROM public.campaign_opt_outs o
        WHERE o.lead_id = l.id
          AND (o.channel IS NULL OR o.channel = 'WHATSAPP')
      )
      -- Do not re-list a lead/contact already used or reserved in any manual
      -- WhatsApp path, nor a lead already present in the Daily-6 ledger.
      AND NOT EXISTS (
        SELECT 1 FROM public.daily6_send_ledger d
        WHERE d.lead_id = l.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pilot_manual_message_preparations p
        WHERE p.lead_id = l.id
          AND p.channel = 'WHATSAPP'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pilot_manual_contacts p
        WHERE p.lead_id = l.id
          AND p.channel = 'WHATSAPP_MANUAL'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.pilot_manual_whatsapp_cloud_send_attempts p
        WHERE p.lead_id = l.id
      )
  ), deduplicated AS (
    SELECT c.*,
           row_number() OVER (
             PARTITION BY c.whatsapp_value
             ORDER BY c.business_identity_confirmed DESC,
                      c.business_active_pass DESC,
                      c.lead_id
           ) AS phone_rank
    FROM candidate c
  )
  SELECT
    c.lead_id,
    c.contact_id,
    c.lead_name,
    c.city,
    c.category,
    c.whatsapp_value,
    c.whatsapp_source,
    c.whatsapp_evidence,
    c.website_status,
    c.qualification_status,
    c.business_identity_confirmed,
    c.business_active_pass
  FROM deduplicated c
  WHERE c.phone_rank = 1
  ORDER BY c.business_identity_confirmed DESC,
           c.business_active_pass DESC,
           c.lead_id
  LIMIT greatest(0, least(coalesce(p_limit, 0), 30));
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities(text, text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_whatsapp_opportunities(text, text, integer)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
