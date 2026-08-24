BEGIN;

-- Read-only quality/safety projection for manual review. It deliberately
-- exposes no contact value and has no batch, provider, or delivery behavior.
-- Evidence is evaluated from the newest row for each lead/evidence type.
CREATE OR REPLACE FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(
  p_city text,
  p_category text,
  p_limit integer
)
RETURNS TABLE(
  lead_id uuid,
  city text,
  category text,
  identity_state text,
  activity_state text,
  email_state text,
  website_state text,
  lead_blocked boolean,
  business_closed boolean,
  prior_contact boolean,
  duplicate boolean,
  pending_or_ambiguous_send boolean,
  suppressed boolean,
  hard_bounce boolean,
  opt_out boolean,
  do_not_contact boolean,
  nao_contatar boolean,
  email_channel_allowed boolean,
  current_evidence_present boolean,
  legacy_status_only boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH latest_evidence AS (
    SELECT DISTINCT ON (e.lead_id, e.evidence_type)
      e.lead_id,
      e.evidence_type,
      e.verification_status,
      e.result,
      e.confidence
    FROM public.lead_evidence e
    WHERE e.evidence_type IN ('BUSINESS_IDENTITY', 'BUSINESS_ACTIVITY', 'WEBSITE', 'BUSINESS_EMAIL')
    ORDER BY e.lead_id, e.evidence_type, e.observed_at DESC, e.created_at DESC, e.id DESC
  ),
  current_evidence AS (
    SELECT
      e.lead_id,
      bool_or(e.verification_status = 'VERIFIED' AND e.confidence >= 0.850) AS current_evidence_present
    FROM latest_evidence e
    GROUP BY e.lead_id
  ),
  legacy_evidence AS (
    SELECT e.lead_id, true AS legacy_present
    FROM public.lead_evidence e
    WHERE e.evidence_type = 'LEGACY'
    GROUP BY e.lead_id
  ),
  candidate AS (
    SELECT
      l.id AS lead_id,
      c.contact_id,
      c.email_norm,
      c.email_is_valid,
      c.email_verified_at,
      c.email_source_present,
      c.email_format_valid,
      l.city,
      l.category,
      l.is_blocked,
      l.is_closed,
      l.do_not_contact,
      l.crm_stage,
      l.website,
      l.website_status,
      identity_evidence.verification_status AS identity_verification_status,
      identity_evidence.result AS identity_result,
      identity_evidence.confidence AS identity_confidence,
      activity_evidence.verification_status AS activity_verification_status,
      activity_evidence.result AS activity_result,
      activity_evidence.confidence AS activity_confidence,
      website_evidence.verification_status AS website_verification_status,
      website_evidence.result AS website_result,
      website_evidence.confidence AS website_confidence,
      email_evidence.ownership AS email_ownership,
      email_evidence.origin AS email_origin,
      email_evidence.human_decision AS email_human_decision,
      coalesce(current_evidence.current_evidence_present, false) AS current_evidence_present,
      coalesce(legacy_evidence.legacy_present, false) AS legacy_present
    FROM public.leads l
    LEFT JOIN LATERAL (
      SELECT
        c0.id AS contact_id,
        lower(btrim(c0.normalized_value)) AS email_norm,
        c0.is_valid AS email_is_valid,
        c0.verified_at AS email_verified_at,
        nullif(btrim(c0.source), '') IS NOT NULL AS email_source_present,
        c0.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' AS email_format_valid
      FROM public.lead_contacts c0
      WHERE c0.lead_id = l.id
        AND upper(c0.type) = 'EMAIL'
      ORDER BY
        (
          c0.is_valid
          AND c0.verified_at IS NOT NULL
          AND btrim(c0.source) <> ''
          AND c0.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
          AND coalesce((
            SELECT
              e0.ownership = 'BUSINESS'
              AND e0.origin IN ('PUBLIC_BUSINESS_SOURCE', 'DIRECTLY_PROVIDED', 'SIGNED_RECORD')
              AND e0.human_decision IN ('APPROVED', 'AUTOMATED_COMPLIANCE')
            FROM public.contact_email_business_evidence e0
            WHERE e0.contact_id = c0.id
              AND e0.lead_id = l.id
              AND e0.channel = 'EMAIL'
            ORDER BY e0.version DESC, e0.id DESC
            LIMIT 1
          ), false)
        ) DESC,
        (c0.is_valid AND c0.verified_at IS NOT NULL AND btrim(c0.source) <> ''
          AND c0.normalized_value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') DESC,
        c0.updated_at DESC,
        c0.id
      LIMIT 1
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT e.ownership, e.origin, e.human_decision
      FROM public.contact_email_business_evidence e
      WHERE e.contact_id = c.contact_id
        AND e.lead_id = l.id
        AND e.channel = 'EMAIL'
      ORDER BY e.version DESC, e.id DESC
      LIMIT 1
    ) email_evidence ON true
    LEFT JOIN latest_evidence identity_evidence
      ON identity_evidence.lead_id = l.id
      AND identity_evidence.evidence_type = 'BUSINESS_IDENTITY'
    LEFT JOIN latest_evidence activity_evidence
      ON activity_evidence.lead_id = l.id
      AND activity_evidence.evidence_type = 'BUSINESS_ACTIVITY'
    LEFT JOIN latest_evidence website_evidence
      ON website_evidence.lead_id = l.id
      AND website_evidence.evidence_type = 'WEBSITE'
    LEFT JOIN current_evidence ON current_evidence.lead_id = l.id
    LEFT JOIN legacy_evidence ON legacy_evidence.lead_id = l.id
    WHERE l.city = p_city
      AND (p_category IS NULL OR l.category = p_category)
  ),
  states AS (
    SELECT
      c.*,
      CASE
        WHEN c.identity_verification_status = 'VERIFIED'
          AND c.identity_confidence >= 0.850
          AND c.identity_result = 'BUSINESS_IDENTITY_CONFIRMED'
          THEN 'CONFIRMED'
        WHEN c.identity_verification_status = 'VERIFIED'
          AND c.identity_confidence >= 0.850
          AND c.identity_result = 'BUSINESS_IDENTITY_UNCONFIRMED'
          THEN 'UNCONFIRMED'
        ELSE 'UNKNOWN'
      END AS identity_state,
      CASE
        WHEN c.activity_verification_status = 'VERIFIED'
          AND c.activity_confidence >= 0.850
          AND c.activity_result = 'ACTIVE'
          THEN 'ACTIVE'
        WHEN c.activity_verification_status = 'VERIFIED'
          AND c.activity_confidence >= 0.850
          AND c.activity_result = 'INACTIVE'
          THEN 'INACTIVE'
        ELSE 'UNKNOWN'
      END AS activity_state,
      CASE
        WHEN c.contact_id IS NULL THEN 'MISSING'
        WHEN c.email_is_valid
          AND c.email_verified_at IS NOT NULL
          AND c.email_source_present
          AND c.email_format_valid
          AND c.email_ownership = 'BUSINESS'
          AND c.email_origin IN ('PUBLIC_BUSINESS_SOURCE', 'DIRECTLY_PROVIDED', 'SIGNED_RECORD')
          AND c.email_human_decision IN ('APPROVED', 'AUTOMATED_COMPLIANCE')
          THEN 'PASS'
        WHEN c.email_human_decision = 'REJECTED'
          OR c.email_ownership = 'PERSONAL'
          THEN 'UNSUITABLE'
        ELSE 'UNKNOWN'
      END AS email_state,
      CASE
        WHEN nullif(btrim(c.website), '') IS NOT NULL
          OR c.website_status = 'OFFICIAL_SITE_FOUND'
          OR EXISTS (
            SELECT 1 FROM public.lead_evidence website_signal
            WHERE website_signal.lead_id = c.lead_id
              AND website_signal.evidence_type = 'WEBSITE'
              AND website_signal.verification_status = 'VERIFIED'
              AND website_signal.result = 'OFFICIAL_SITE_FOUND'
              AND website_signal.confidence >= 0.850
          )
          THEN 'OFFICIAL_SITE_FOUND'
        WHEN c.website_status = 'NO_OFFICIAL_SITE_CONFIRMED'
          OR (c.website_verification_status = 'VERIFIED'
            AND c.website_confidence >= 0.850
            AND c.website_result = 'NO_OFFICIAL_SITE_CONFIRMED')
          THEN 'NO_OFFICIAL_SITE_CONFIRMED'
        ELSE 'UNKNOWN'
      END AS website_state
    FROM candidate c
  ),
  flags AS (
    SELECT
      s.*,
      (
        s.email_norm IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.lead_contacts duplicate_contact
          WHERE upper(duplicate_contact.type) = 'EMAIL'
            AND duplicate_contact.lead_id <> s.lead_id
            AND lower(btrim(duplicate_contact.normalized_value)) = s.email_norm
        )
      ) AS duplicate,
      (
        EXISTS (
          SELECT 1
          FROM public.pilot_manual_email_send_attempts attempt
          JOIN public.lead_contacts previous_contact ON previous_contact.id = attempt.contact_id
          WHERE (attempt.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR attempt.lead_id = s.lead_id)
        )
        OR EXISTS (
          SELECT 1
          FROM public.pilot_manual_contacts previous_contacted
          JOIN public.lead_contacts previous_contact ON previous_contact.id = previous_contacted.contact_id
          WHERE previous_contacted.channel = 'EMAIL_MANUAL'
            AND (previous_contacted.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR previous_contacted.lead_id = s.lead_id)
        )
        OR EXISTS (
          SELECT 1
          FROM public.daily6_send_ledger daily6_ledger
          WHERE daily6_ledger.lead_id = s.lead_id
             OR EXISTS (
               SELECT 1
               FROM public.lead_contacts previous_contact
               WHERE previous_contact.lead_id = daily6_ledger.lead_id
                 AND s.email_norm IS NOT NULL
                 AND lower(btrim(previous_contact.normalized_value)) = s.email_norm
                 AND upper(previous_contact.type) = 'EMAIL'
             )
        )
        OR EXISTS (
          SELECT 1
          FROM public.pilot_manual_message_preparations preparation
          JOIN public.lead_contacts previous_contact ON previous_contact.id = preparation.contact_id
          JOIN public.pilot_manual_message_events message_event ON message_event.preparation_id = preparation.id
          WHERE preparation.channel = 'EMAIL'
            AND message_event.event_type = 'CONTACT_CONFIRMED'
            AND message_event.result = 'SENT_CONFIRMED'
            AND (preparation.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR preparation.lead_id = s.lead_id)
        )
      ) AS prior_contact,
      (
        EXISTS (
          SELECT 1
          FROM public.pilot_manual_message_preparations preparation
          LEFT JOIN public.pilot_manual_message_events message_event
            ON message_event.preparation_id = preparation.id
          JOIN public.lead_contacts previous_contact ON previous_contact.id = preparation.contact_id
          WHERE preparation.channel = 'EMAIL'
            AND (preparation.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
           AND (s.email_norm IS NOT NULL OR preparation.lead_id = s.lead_id)
            AND NOT EXISTS (
              SELECT 1
              FROM public.pilot_manual_message_events terminal_event
              WHERE terminal_event.preparation_id = preparation.id
                AND terminal_event.event_type IN ('CANCELLED', 'CONTACT_CONFIRMED')
            )
            AND (
              message_event.id IS NULL
              OR message_event.event_type = 'OPENED'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.pilot_manual_email_send_attempts attempt
          LEFT JOIN public.pilot_manual_email_send_events send_event ON send_event.attempt_id = attempt.id
          JOIN public.lead_contacts previous_contact ON previous_contact.id = attempt.contact_id
          WHERE (attempt.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR attempt.lead_id = s.lead_id)
            AND (send_event.id IS NULL OR send_event.event_type = 'AMBIGUOUS')
        )
        OR EXISTS (
          SELECT 1
          FROM public.daily6_send_ledger daily6_ledger
          WHERE daily6_ledger.status IN ('PENDING', 'RESERVED', 'AMBIGUOUS')
            AND (
              daily6_ledger.lead_id = s.lead_id
              OR EXISTS (
                SELECT 1
                FROM public.lead_contacts previous_contact
                WHERE previous_contact.lead_id = daily6_ledger.lead_id
                  AND upper(previous_contact.type) = 'EMAIL'
                  AND s.email_norm IS NOT NULL
                  AND lower(btrim(previous_contact.normalized_value)) = s.email_norm
              )
            )
        )
      ) AS pending_or_ambiguous_send,
      (
        EXISTS (
          SELECT 1
          FROM public.contact_delivery_suppressions suppression
          LEFT JOIN public.lead_contacts suppressed_contact ON suppressed_contact.id = suppression.contact_id
          WHERE suppression.channel = 'EMAIL'
            AND (
              suppression.lead_id = s.lead_id
              OR (s.email_norm IS NOT NULL AND lower(btrim(suppressed_contact.normalized_value)) = s.email_norm)
            )
        )
        OR (
          s.email_norm IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.email_precontact_delivery_suppressions precontact
            WHERE precontact.identity_fingerprint = public.email_precontact_identity_fingerprint(s.email_norm)
          )
        )
      ) AS suppressed,
      (
        EXISTS (
          SELECT 1
          FROM public.contact_delivery_suppressions suppression
          LEFT JOIN public.lead_contacts suppressed_contact ON suppressed_contact.id = suppression.contact_id
          WHERE suppression.channel = 'EMAIL'
            AND suppression.reason = 'HARD_BOUNCE'
            AND (
              suppression.lead_id = s.lead_id
              OR (s.email_norm IS NOT NULL AND lower(btrim(suppressed_contact.normalized_value)) = s.email_norm)
            )
        )
        OR (
          s.email_norm IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.email_precontact_delivery_suppressions precontact
            WHERE precontact.reason = 'HARD_BOUNCE'
              AND precontact.identity_fingerprint = public.email_precontact_identity_fingerprint(s.email_norm)
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.pilot_manual_email_send_attempts attempt
          JOIN public.lead_contacts previous_contact ON previous_contact.id = attempt.contact_id
          JOIN public.pilot_manual_email_send_events send_event ON send_event.attempt_id = attempt.id
          WHERE send_event.event_type = 'FAILED'
            AND send_event.error_code = 'HARD_BOUNCE'
            AND (attempt.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR attempt.lead_id = s.lead_id)
        )
      ) AS hard_bounce,
      (
        EXISTS (
          SELECT 1
          FROM public.campaign_opt_outs opt_out
          LEFT JOIN public.leads opt_out_lead ON opt_out_lead.id = opt_out.lead_id
          LEFT JOIN public.lead_contacts opt_out_contact
            ON opt_out_contact.lead_id = opt_out.lead_id
            AND upper(opt_out_contact.type) = 'EMAIL'
          WHERE (opt_out.channel IS NULL OR opt_out.channel = 'EMAIL')
            AND (
              opt_out.lead_id = s.lead_id
              OR (s.email_norm IS NOT NULL AND lower(btrim(opt_out_contact.normalized_value)) = s.email_norm)
              OR (s.email_norm IS NOT NULL AND lower(btrim(opt_out_lead.email)) = s.email_norm)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.contact_delivery_suppressions suppression
          LEFT JOIN public.lead_contacts suppressed_contact ON suppressed_contact.id = suppression.contact_id
          WHERE suppression.channel = 'EMAIL'
            AND suppression.reason = 'OPT_OUT'
            AND (
              suppression.lead_id = s.lead_id
              OR (s.email_norm IS NOT NULL AND lower(btrim(suppressed_contact.normalized_value)) = s.email_norm)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.pilot_manual_message_preparations preparation
          JOIN public.lead_contacts previous_contact ON previous_contact.id = preparation.contact_id
          JOIN public.pilot_manual_message_events message_event ON message_event.preparation_id = preparation.id
          WHERE preparation.channel = 'EMAIL'
            AND message_event.event_type = 'RESPONSE_RECORDED'
            AND message_event.result = 'OPT_OUT'
            AND (preparation.lead_id = s.lead_id OR lower(btrim(previous_contact.normalized_value)) = s.email_norm)
            AND (s.email_norm IS NOT NULL OR preparation.lead_id = s.lead_id)
        )
      ) AS opt_out
    FROM states s
  ),
  scored AS (
    SELECT
      f.*,
      true AS email_channel_allowed
    FROM (
      SELECT
        f0.*,
        f0.is_blocked AS lead_blocked,
        f0.is_closed AS business_closed,
        f0.do_not_contact AS do_not_contact,
        coalesce(f0.crm_stage = 'NAO_CONTATAR', false) AS nao_contatar
      FROM flags f0
    ) f
  )
  SELECT
    scored.lead_id,
    scored.city,
    scored.category,
    scored.identity_state,
    scored.activity_state,
    scored.email_state,
    scored.website_state,
    scored.lead_blocked,
    scored.business_closed,
    scored.prior_contact,
    scored.duplicate,
    scored.pending_or_ambiguous_send,
    scored.suppressed,
    scored.hard_bounce,
    scored.opt_out,
    scored.do_not_contact,
    scored.nao_contatar,
    scored.email_channel_allowed,
    scored.current_evidence_present,
    scored.legacy_present AND NOT scored.current_evidence_present AS legacy_status_only
  FROM scored
  ORDER BY
    CASE
      WHEN scored.lead_blocked
        OR scored.prior_contact
        OR scored.duplicate
        OR scored.pending_or_ambiguous_send
        OR scored.suppressed
        OR scored.hard_bounce
        OR scored.opt_out
        OR scored.do_not_contact
        OR scored.nao_contatar
        OR NOT scored.email_channel_allowed
        THEN 3
      WHEN scored.business_closed
        OR scored.identity_state = 'UNCONFIRMED'
        OR scored.activity_state = 'INACTIVE'
        OR scored.website_state = 'OFFICIAL_SITE_FOUND'
        THEN 2
      WHEN scored.identity_state = 'UNKNOWN'
        OR scored.activity_state = 'UNKNOWN'
        OR scored.email_state IN ('UNKNOWN', 'MISSING', 'UNSUITABLE')
        OR scored.website_state = 'UNKNOWN'
        OR NOT scored.current_evidence_present
        OR (scored.legacy_present AND NOT scored.current_evidence_present)
        THEN 1
      ELSE 0
    END,
    scored.lead_id
  LIMIT greatest(0, least(coalesce(p_limit, 0), 30));
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer) FROM authenticated;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.list_daily6_opportunity_shadow(text, text, integer)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
