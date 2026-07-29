BEGIN;

CREATE TABLE IF NOT EXISTS contact_channel_authorization_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES contact_channel_authorizations(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'B2B_PROSPECTION'),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text NOT NULL CHECK (char_length(btrim(revoked_by)) BETWEEN 1 AND 100),
  reason_fingerprint char(64) NOT NULL CHECK (reason_fingerprint ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (contact_id,lead_id) REFERENCES lead_contacts(id,lead_id) ON DELETE RESTRICT,
  UNIQUE (authorization_id)
);
CREATE INDEX IF NOT EXISTS contact_channel_authorization_revocations_lookup_idx
  ON contact_channel_authorization_revocations(lead_id,contact_id,purpose,revoked_at DESC);
ALTER TABLE contact_channel_authorization_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_channel_authorization_revocations FROM PUBLIC;

CREATE OR REPLACE FUNCTION lock_narrow_contact_resolution_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE target_lead uuid;
BEGIN
  target_lead := coalesce(
    (to_jsonb(NEW)->>'lead_id')::uuid,
    (to_jsonb(NEW)->>'id')::uuid,
    (to_jsonb(OLD)->>'lead_id')::uuid,
    (to_jsonb(OLD)->>'id')::uuid
  );
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || target_lead::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-messaging-purpose:' || target_lead::text || ':B2B_PROSPECTION',0));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contact_channel_authorizations_narrow_lock ON contact_channel_authorizations;
CREATE TRIGGER contact_channel_authorizations_narrow_lock
BEFORE INSERT ON contact_channel_authorizations
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

DROP TRIGGER IF EXISTS contact_email_business_evidence_narrow_lock ON contact_email_business_evidence;
CREATE TRIGGER contact_email_business_evidence_narrow_lock
BEFORE INSERT ON contact_email_business_evidence
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

DROP TRIGGER IF EXISTS contact_authorization_revocations_narrow_lock ON contact_channel_authorization_revocations;
CREATE TRIGGER contact_authorization_revocations_narrow_lock
BEFORE INSERT ON contact_channel_authorization_revocations
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

DROP TRIGGER IF EXISTS pilot_reviews_narrow_lock ON pilot_reviews;
CREATE TRIGGER pilot_reviews_narrow_lock
BEFORE INSERT ON pilot_reviews
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

DROP TRIGGER IF EXISTS campaign_opt_outs_narrow_lock ON campaign_opt_outs;
CREATE TRIGGER campaign_opt_outs_narrow_lock
BEFORE INSERT ON campaign_opt_outs
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

DROP TRIGGER IF EXISTS leads_narrow_lock ON leads;
CREATE TRIGGER leads_narrow_lock
BEFORE UPDATE OF is_blocked,do_not_contact,crm_stage ON leads
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_resolution_write();

CREATE OR REPLACE FUNCTION lock_narrow_contact_pilot_status_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE target_lead uuid;
BEGIN
  FOR target_lead IN
    SELECT pl.lead_id FROM public.pilot_leads pl
    WHERE pl.pilot_run_id=NEW.id ORDER BY pl.lead_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || target_lead::text,0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'manual-messaging-purpose:' || target_lead::text || ':B2B_PROSPECTION',0));
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pilot_runs_narrow_lock ON pilot_runs;
CREATE TRIGGER pilot_runs_narrow_lock
BEFORE UPDATE OF status ON pilot_runs
FOR EACH ROW EXECUTE FUNCTION lock_narrow_contact_pilot_status_write();

CREATE OR REPLACE FUNCTION resolve_narrow_contact(
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

  -- Global lock order: lead first, then lead+purpose.
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-messaging:' || p_lead_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'manual-messaging-purpose:' || p_lead_id::text || ':B2B_PROSPECTION',0));

  RETURN QUERY
  SELECT c.normalized_value,
    encode(digest(c.normalized_value,'sha256'),'hex')::char(64),
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
        AND ee.ownership='BUSINESS' AND ee.human_decision='APPROVED'
        AND ee.origin IN ('PUBLIC_BUSINESS_SOURCE','DIRECTLY_PROVIDED','SIGNED_RECORD'))
    )
  FOR UPDATE OF pr,pl,l,c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact resolution ineligible' USING ERRCODE='P0001';
  END IF;
END $$;

REVOKE ALL ON FUNCTION resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_narrow_contact_resolution_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_narrow_contact_pilot_status_write() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON contact_channel_authorization_revocations FROM anon;
    REVOKE ALL ON FUNCTION resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON contact_channel_authorization_revocations FROM authenticated;
    REVOKE ALL ON FUNCTION resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON FUNCTION resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)
      FROM lead_finder_api_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    GRANT EXECUTE ON FUNCTION resolve_narrow_contact(uuid,uuid,uuid,text,text,text,text)
      TO lead_finder_contact_resolver_runtime;
  END IF;
END $$;

COMMIT;
