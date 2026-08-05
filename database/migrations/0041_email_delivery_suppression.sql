BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_delivery_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  reason text NOT NULL CHECK (
    reason IN ('HARD_BOUNCE','INVALID_CONTACT','OPT_OUT','COMPLAINT')
  ),
  source text NOT NULL CHECK (
    char_length(source) BETWEEN 1 AND 64
    AND source ~ '^[A-Z][A-Z0-9_]*$'
  ),
  event_fingerprint char(64) NOT NULL CHECK (
    event_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id,lead_id)
    REFERENCES public.lead_contacts(id,lead_id)
    ON DELETE RESTRICT,
  UNIQUE (event_fingerprint)
);

CREATE INDEX IF NOT EXISTS contact_delivery_suppressions_contact_idx
  ON public.contact_delivery_suppressions(
    contact_id,channel,occurred_at DESC,id
  );
CREATE INDEX IF NOT EXISTS contact_delivery_suppressions_lead_idx
  ON public.contact_delivery_suppressions(
    lead_id,channel,occurred_at DESC,id
  );

DROP TRIGGER IF EXISTS contact_delivery_suppressions_append_only
  ON public.contact_delivery_suppressions;
CREATE TRIGGER contact_delivery_suppressions_append_only
BEFORE UPDATE OR DELETE ON public.contact_delivery_suppressions
FOR EACH ROW
EXECUTE FUNCTION public.reject_manual_messaging_history_mutation();

ALTER TABLE public.contact_delivery_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_delivery_suppressions FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_email_delivery_suppression(
  p_contact_id uuid,
  p_lead_id uuid,
  p_reason text,
  p_source text,
  p_event_fingerprint char(64),
  p_occurred_at timestamptz
)
RETURNS TABLE(
  suppression_id uuid,
  replayed boolean,
  contact_invalidated boolean,
  lead_email_suppressed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  normalized_reason text := upper(btrim(p_reason));
  normalized_source text := upper(btrim(p_source));
  target_contact record;
  existing_suppression public.contact_delivery_suppressions%ROWTYPE;
  inserted_suppression public.contact_delivery_suppressions%ROWTYPE;
  affected_rows integer := 0;
  email_opt_out_exists boolean := false;
BEGIN
  IF p_contact_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'suppression target is required' USING ERRCODE='22023';
  END IF;
  IF normalized_reason NOT IN (
    'HARD_BOUNCE','INVALID_CONTACT','OPT_OUT','COMPLAINT'
  ) THEN
    RAISE EXCEPTION 'suppression reason is invalid' USING ERRCODE='22023';
  END IF;
  IF normalized_source !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'suppression source is invalid' USING ERRCODE='22023';
  END IF;
  IF btrim(p_event_fingerprint::text) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'suppression fingerprint is invalid' USING ERRCODE='22023';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'suppression occurrence time is required' USING ERRCODE='22023';
  END IF;

  -- Shared lock order: lead first, then contact.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('manual-messaging:' || p_lead_id::text,0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('email-delivery-suppression:' || p_contact_id::text,0)
  );

  SELECT c.id,c.lead_id,c.type,c.is_valid
  INTO target_contact
  FROM public.lead_contacts c
  WHERE c.id=p_contact_id AND c.lead_id=p_lead_id
  FOR UPDATE;

  IF NOT FOUND OR upper(target_contact.type) <> 'EMAIL' THEN
    RAISE EXCEPTION 'suppression target is not an email contact'
      USING ERRCODE='22023';
  END IF;

  SELECT *
  INTO existing_suppression
  FROM public.contact_delivery_suppressions s
  WHERE s.event_fingerprint=p_event_fingerprint
  LIMIT 1;

  IF FOUND THEN
    IF existing_suppression.contact_id IS DISTINCT FROM p_contact_id
      OR existing_suppression.lead_id IS DISTINCT FROM p_lead_id
      OR existing_suppression.reason IS DISTINCT FROM normalized_reason
      OR existing_suppression.source IS DISTINCT FROM normalized_source
      OR existing_suppression.occurred_at IS DISTINCT FROM p_occurred_at
    THEN
      RAISE EXCEPTION 'suppression fingerprint conflicts with persisted event'
        USING ERRCODE='23505';
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.campaign_opt_outs o
      WHERE o.lead_id=p_lead_id
        AND (o.channel IS NULL OR o.channel='EMAIL')
    ) INTO email_opt_out_exists;

    RETURN QUERY SELECT
      existing_suppression.id,
      true,
      normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT')
        AND NOT target_contact.is_valid,
      email_opt_out_exists;
    RETURN;
  END IF;

  INSERT INTO public.contact_delivery_suppressions(
    contact_id,lead_id,channel,reason,source,event_fingerprint,occurred_at
  ) VALUES (
    p_contact_id,p_lead_id,'EMAIL',normalized_reason,normalized_source,
    p_event_fingerprint,p_occurred_at
  )
  RETURNING * INTO inserted_suppression;

  IF normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT') THEN
    UPDATE public.lead_contacts
    SET is_valid=false,updated_at=clock_timestamp()
    WHERE id=p_contact_id AND lead_id=p_lead_id AND is_valid;
    GET DIAGNOSTICS affected_rows=ROW_COUNT;
  END IF;

  IF normalized_reason IN ('OPT_OUT','COMPLAINT') THEN
    SELECT EXISTS(
      SELECT 1 FROM public.campaign_opt_outs o
      WHERE o.lead_id=p_lead_id
        AND (o.channel IS NULL OR o.channel='EMAIL')
    ) INTO email_opt_out_exists;

    IF NOT email_opt_out_exists THEN
      INSERT INTO public.campaign_opt_outs(
        lead_id,channel,reason,source
      ) VALUES (
        p_lead_id,'EMAIL','EMAIL_' || normalized_reason,normalized_source
      );
      email_opt_out_exists := true;
    END IF;
  END IF;

  RETURN QUERY SELECT
    inserted_suppression.id,
    false,
    affected_rows > 0,
    email_opt_out_exists;
END
$function$;

REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
  uuid,uuid,text,text,char,timestamptz
) FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.contact_delivery_suppressions FROM anon;
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,text,text,char,timestamptz
    ) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.contact_delivery_suppressions FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,text,text,char,timestamptz
    ) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON TABLE public.contact_delivery_suppressions
      FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,text,text,char,timestamptz
    ) FROM lead_finder_api_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON TABLE public.contact_delivery_suppressions FROM service_role;
    GRANT SELECT ON TABLE public.contact_delivery_suppressions TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,text,text,char,timestamptz
    ) TO service_role;
  END IF;
END
$roles$;

COMMIT;
