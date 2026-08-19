BEGIN;

-- Append-only registry evidence for the manual-review DailyWhatsApp funnel.
-- This table is intentionally separate from leads and from all send state.
-- A future enumerating source may write evidence through a dedicated reviewed
-- ingestion path; the read-only opportunity resolver below only consumes
-- CONFIRMED records with an explicit opening_date.
CREATE OR REPLACE FUNCTION lead_finder_internal.is_valid_numeric_cnpj(p_cnpj text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $$
DECLARE
  digits text := regexp_replace(p_cnpj, '[^0-9]', '', 'g');
  first_sum integer;
  second_sum integer;
  first_digit integer;
  second_digit integer;
BEGIN
  IF p_cnpj !~ '^[0-9./ -]+$' THEN RETURN false; END IF;
  IF digits !~ '^[0-9]{14}$' THEN RETURN false; END IF;
  IF length(replace(digits, substr(digits, 1, 1), '')) = 0 THEN RETURN false; END IF;
  SELECT sum(substr(digits, i, 1)::integer * w)
    INTO first_sum
    FROM unnest(ARRAY[5,4,3,2,9,8,7,6,5,4,3,2]) WITH ORDINALITY AS x(w, i);
  first_digit := CASE WHEN first_sum % 11 < 2 THEN 0 ELSE 11 - (first_sum % 11) END;
  IF substr(digits, 13, 1)::integer <> first_digit THEN RETURN false; END IF;
  SELECT sum(substr(digits, i, 1)::integer * w)
    INTO second_sum
    FROM unnest(ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2]) WITH ORDINALITY AS x(w, i);
  second_digit := CASE WHEN second_sum % 11 < 2 THEN 0 ELSE 11 - (second_sum % 11) END;
  RETURN substr(digits, 14, 1)::integer = second_digit;
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.is_valid_numeric_cnpj(text) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.lead_registry_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$' AND lead_finder_internal.is_valid_numeric_cnpj(cnpj)),
  registration_status text NOT NULL DEFAULT 'UNKNOWN',
  opening_date date,
  status_date date,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 128),
  source_locator text NOT NULL CHECK (char_length(source_locator) BETWEEN 1 AND 512),
  match_decision text NOT NULL CHECK (match_decision IN ('CONFIRMED', 'AMBIGUOUS', 'REJECTED')),
  match_confidence numeric(4,3) NOT NULL CHECK (match_confidence >= 0 AND match_confidence <= 1),
  observed_at timestamptz NOT NULL,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS lead_registry_evidence_recent_idx
  ON public.lead_registry_evidence (lead_id, opening_date DESC, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pilot_manual_contacts_whatsapp_contact_idx
  ON public.pilot_manual_contacts (contact_id, recorded_at DESC)
  WHERE channel = 'WHATSAPP_MANUAL';
CREATE INDEX IF NOT EXISTS pilot_manual_message_preparations_whatsapp_contact_idx
  ON public.pilot_manual_message_preparations (contact_id, prepared_at DESC)
  WHERE channel = 'WHATSAPP';
CREATE INDEX IF NOT EXISTS pilot_manual_whatsapp_cloud_attempts_contact_idx
  ON public.pilot_manual_whatsapp_cloud_send_attempts (contact_id, reserved_at DESC);

CREATE OR REPLACE FUNCTION lead_finder_internal.reject_lead_registry_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'LEAD_REGISTRY_EVIDENCE_APPEND_ONLY';
END;
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.reject_lead_registry_evidence_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS lead_registry_evidence_append_only ON public.lead_registry_evidence;
CREATE TRIGGER lead_registry_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.lead_registry_evidence
  FOR EACH ROW EXECUTE FUNCTION lead_finder_internal.reject_lead_registry_evidence_mutation();

ALTER TABLE public.lead_registry_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_registry_evidence FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.lead_registry_evidence FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.lead_registry_evidence FROM authenticated;
  END IF;
END $$;

-- Read-only resolver: it composes the existing WhatsApp-only opportunity
-- function and adds a confirmed opening-date signal. It never creates a
-- batch, preparation, ledger row, provider call, or message.
CREATE OR REPLACE FUNCTION lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities(
  p_city text,
  p_category text,
  p_opened_since date,
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
  business_active_pass boolean,
  cnpj text,
  cnpj_opening_date date,
  cnpj_registration_status text,
  cnpj_source text
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
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_contacts email_contact
        WHERE email_contact.lead_id = l.id
          AND upper(email_contact.type) = 'EMAIL'
          AND email_contact.is_valid = true
          AND email_contact.verified_at IS NOT NULL
          AND btrim(email_contact.source) <> ''
      )
       AND NOT EXISTS (
         SELECT 1 FROM public.campaign_opt_outs o
         WHERE o.lead_id = l.id
           AND (o.channel IS NULL OR o.channel = 'WHATSAPP')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.campaign_opt_outs o
         LEFT JOIN public.lead_contacts opted_contact
           ON opted_contact.lead_id = o.lead_id
          AND upper(opted_contact.type) = 'TELEFONE'
         JOIN public.leads opted_lead ON opted_lead.id = o.lead_id
         WHERE (o.channel IS NULL OR o.channel = 'WHATSAPP')
           AND (
             regexp_replace(opted_contact.normalized_value, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
             OR regexp_replace(opted_lead.whatsapp, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
           )
       )
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
         SELECT 1
         FROM public.pilot_manual_message_preparations p
         JOIN public.lead_contacts previous_contact ON previous_contact.id = p.contact_id
         JOIN public.leads previous_lead ON previous_lead.id = p.lead_id
         WHERE p.channel = 'WHATSAPP'
           AND (
             regexp_replace(previous_contact.normalized_value, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
             OR regexp_replace(previous_lead.whatsapp, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.pilot_manual_contacts p
         WHERE p.lead_id = l.id
           AND p.channel = 'WHATSAPP_MANUAL'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.pilot_manual_contacts p
         JOIN public.lead_contacts previous_contact ON previous_contact.id = p.contact_id
         JOIN public.leads previous_lead ON previous_lead.id = p.lead_id
         WHERE p.channel = 'WHATSAPP_MANUAL'
           AND (
             regexp_replace(previous_contact.normalized_value, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
             OR regexp_replace(previous_lead.whatsapp, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.pilot_manual_whatsapp_cloud_send_attempts p
         WHERE p.lead_id = l.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.pilot_manual_whatsapp_cloud_send_attempts p
         JOIN public.lead_contacts previous_contact ON previous_contact.id = p.contact_id
         JOIN public.leads previous_lead ON previous_lead.id = p.lead_id
         WHERE regexp_replace(previous_contact.normalized_value, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
            OR regexp_replace(previous_lead.whatsapp, '[^0-9]', '', 'g')
               = regexp_replace(c.whatsapp_value, '[^0-9]', '', 'g')
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
  ), base AS (
    SELECT * FROM deduplicated WHERE phone_rank = 1
  ), latest_observation AS (
    SELECT DISTINCT ON (e.lead_id)
      e.lead_id,
      e.cnpj,
      e.opening_date,
      e.registration_status,
      e.source,
      e.match_decision,
      e.match_confidence
    FROM public.lead_registry_evidence e
    ORDER BY e.lead_id, e.observed_at DESC, e.created_at DESC, e.id DESC
  ), latest_registry AS (
    SELECT *
    FROM latest_observation
    WHERE match_decision = 'CONFIRMED'
      AND match_confidence >= 0.800
      AND registration_status = 'ACTIVE'
      AND opening_date IS NOT NULL
      AND opening_date <= current_date
  ), ranked AS (
    SELECT b.*, r.cnpj, r.opening_date, r.registration_status, r.source,
           row_number() OVER (
             PARTITION BY r.cnpj
             ORDER BY r.opening_date DESC, b.business_identity_confirmed DESC, b.lead_id
           ) AS cnpj_rank
    FROM base b
    JOIN latest_registry r ON r.lead_id = b.lead_id
    WHERE p_opened_since IS NULL OR r.opening_date >= p_opened_since
  )
  SELECT
    b.lead_id,
    b.contact_id,
    b.lead_name,
    b.city,
    b.category,
    b.whatsapp_value,
    b.whatsapp_source,
    b.whatsapp_evidence,
    b.website_status,
    b.qualification_status,
    b.business_identity_confirmed,
    b.business_active_pass,
    cnpj,
    opening_date,
    registration_status,
    left(source, 128)
  FROM ranked
  WHERE cnpj_rank = 1
  ORDER BY opening_date DESC, business_identity_confirmed DESC, lead_id
  LIMIT greatest(0, least(coalesce(p_limit, 0), 30));
$$;

REVOKE ALL ON FUNCTION lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities(text, text, date, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_api_runtime') THEN
    GRANT EXECUTE ON FUNCTION lead_finder_internal.list_dailywhatsapp_recent_cnpj_opportunities(text, text, date, integer)
      TO lead_finder_api_runtime;
  END IF;
END $$;

COMMIT;
