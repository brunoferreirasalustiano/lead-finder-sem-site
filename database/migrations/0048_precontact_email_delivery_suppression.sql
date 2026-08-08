BEGIN;

CREATE SCHEMA IF NOT EXISTS lead_finder_private;
REVOKE ALL ON SCHEMA lead_finder_private FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA lead_finder_private FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA lead_finder_private FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON SCHEMA lead_finder_private FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON SCHEMA lead_finder_private FROM lead_finder_api_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON SCHEMA lead_finder_private FROM lead_finder_contact_resolver_runtime;
  END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS lead_finder_private.email_suppression_hmac_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret bytea NOT NULL CHECK (octet_length(secret)=32),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO lead_finder_private.email_suppression_hmac_key(singleton,secret)
VALUES (true,extensions.gen_random_bytes(32))
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM PUBLIC;

CREATE TABLE IF NOT EXISTS lead_finder_private.email_contact_identities (
  identity_fingerprint char(64) PRIMARY KEY
    CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  suppressed boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM anon;
    REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM authenticated;
    REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM service_role;
    REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM lead_finder_api_runtime;
    REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM lead_finder_api_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM lead_finder_contact_resolver_runtime;
  END IF;
END
$roles$;

CREATE OR REPLACE FUNCTION public.email_precontact_identity_fingerprint(p_email text)
RETURNS char(64)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,lead_finder_private
AS $function$
DECLARE
  normalized_email text := lower(btrim(p_email));
  hmac_secret bytea;
BEGIN
  IF normalized_email IS NULL
    OR char_length(normalized_email) NOT BETWEEN 3 AND 320
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN
    RAISE EXCEPTION 'email suppression identity is invalid' USING ERRCODE='22023';
  END IF;

  SELECT secret INTO hmac_secret
  FROM lead_finder_private.email_suppression_hmac_key
  WHERE singleton=true;

  IF hmac_secret IS NULL OR octet_length(hmac_secret)<>32 THEN
    RAISE EXCEPTION 'email suppression HMAC key is unavailable' USING ERRCODE='55000';
  END IF;

  RETURN encode(
    extensions.hmac(convert_to(normalized_email,'UTF8'),hmac_secret,'sha256'),
    'hex'
  )::char(64);
END
$function$;

REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.email_precontact_delivery_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_fingerprint char(64) NOT NULL
    CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (reason IN ('HARD_BOUNCE','INVALID_CONTACT')),
  source text NOT NULL CHECK (
    char_length(source) BETWEEN 1 AND 64
    AND source ~ '^[A-Z][A-Z0-9_]*$'
  ),
  event_fingerprint char(64) NOT NULL
    CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (identity_fingerprint)
    REFERENCES lead_finder_private.email_contact_identities(identity_fingerprint)
    ON DELETE RESTRICT,
  UNIQUE (event_fingerprint)
);

CREATE INDEX IF NOT EXISTS email_precontact_delivery_suppressions_identity_idx
  ON public.email_precontact_delivery_suppressions(identity_fingerprint,occurred_at DESC,id);

ALTER TABLE public.email_precontact_delivery_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM PUBLIC;

DROP TRIGGER IF EXISTS email_precontact_delivery_suppressions_append_only
  ON public.email_precontact_delivery_suppressions;
CREATE TRIGGER email_precontact_delivery_suppressions_append_only
BEFORE UPDATE OR DELETE ON public.email_precontact_delivery_suppressions
FOR EACH ROW
EXECUTE FUNCTION public.reject_manual_messaging_history_mutation();

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM lead_finder_api_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM lead_finder_contact_resolver_runtime;
  END IF;
END
$roles$;

ALTER TABLE public.lead_contacts
  ADD COLUMN IF NOT EXISTS email_precontact_identity_fingerprint char(64);

INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint)
SELECT DISTINCT public.email_precontact_identity_fingerprint(contact.normalized_value)
FROM public.lead_contacts contact
WHERE upper(contact.type)='EMAIL'
  AND contact.normalized_value IS NOT NULL
  AND btrim(contact.normalized_value)<>''
ON CONFLICT (identity_fingerprint) DO NOTHING;

UPDATE public.lead_contacts contact
SET email_precontact_identity_fingerprint=
  public.email_precontact_identity_fingerprint(contact.normalized_value)
WHERE upper(contact.type)='EMAIL'
  AND contact.normalized_value IS NOT NULL
  AND btrim(contact.normalized_value)<>''
  AND contact.email_precontact_identity_fingerprint IS NULL;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.lead_contacts'::regclass
      AND conname='lead_contacts_email_precontact_identity_format'
  ) THEN
    ALTER TABLE public.lead_contacts
      ADD CONSTRAINT lead_contacts_email_precontact_identity_format
      CHECK (
        email_precontact_identity_fingerprint IS NULL
        OR email_precontact_identity_fingerprint ~ '^[0-9a-f]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.lead_contacts'::regclass
      AND conname='lead_contacts_email_precontact_identity_fk'
  ) THEN
    ALTER TABLE public.lead_contacts
      ADD CONSTRAINT lead_contacts_email_precontact_identity_fk
      FOREIGN KEY (email_precontact_identity_fingerprint)
      REFERENCES lead_finder_private.email_contact_identities(identity_fingerprint)
      ON DELETE RESTRICT;
  END IF;
END
$constraint$;

CREATE INDEX IF NOT EXISTS lead_contacts_email_precontact_identity_idx
  ON public.lead_contacts(email_precontact_identity_fingerprint)
  WHERE email_precontact_identity_fingerprint IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_email_precontact_suppression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,lead_finder_private
AS $function$
DECLARE
  target_fingerprint char(64);
  identity_suppressed boolean;
BEGIN
  IF upper(NEW.type) IS DISTINCT FROM 'EMAIL' THEN
    NEW.email_precontact_identity_fingerprint := NULL;
    RETURN NEW;
  END IF;

  target_fingerprint := public.email_precontact_identity_fingerprint(NEW.normalized_value);

  INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint)
  VALUES (target_fingerprint)
  ON CONFLICT (identity_fingerprint) DO NOTHING;

  SELECT identity.suppressed
  INTO identity_suppressed
  FROM lead_finder_private.email_contact_identities identity
  WHERE identity.identity_fingerprint=target_fingerprint
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'email suppression identity is unavailable' USING ERRCODE='55000';
  END IF;

  NEW.email_precontact_identity_fingerprint := target_fingerprint;
  IF identity_suppressed AND NEW.is_valid THEN
    NEW.is_valid := false;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM PUBLIC;

DROP TRIGGER IF EXISTS lead_contacts_email_precontact_suppression
  ON public.lead_contacts;
CREATE TRIGGER lead_contacts_email_precontact_suppression
BEFORE INSERT OR UPDATE OF type,normalized_value,is_valid
ON public.lead_contacts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_email_precontact_suppression();

CREATE OR REPLACE FUNCTION public.record_precontact_email_delivery_suppression(
  p_email text,
  p_reason text,
  p_source text,
  p_event_fingerprint char(64),
  p_occurred_at timestamptz
)
RETURNS TABLE(
  suppression_id uuid,
  replayed boolean,
  invalidated_contacts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,lead_finder_private
AS $function$
DECLARE
  normalized_reason text := upper(btrim(p_reason));
  normalized_source text := upper(btrim(p_source));
  target_fingerprint char(64);
  existing public.email_precontact_delivery_suppressions%ROWTYPE;
  inserted public.email_precontact_delivery_suppressions%ROWTYPE;
  affected_rows integer := 0;
BEGIN
  IF normalized_reason NOT IN ('HARD_BOUNCE','INVALID_CONTACT') THEN
    RAISE EXCEPTION 'precontact email suppression reason is invalid' USING ERRCODE='22023';
  END IF;
  IF normalized_source IS NULL OR normalized_source !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'precontact email suppression source is invalid' USING ERRCODE='22023';
  END IF;
  IF p_event_fingerprint IS NULL
    OR p_event_fingerprint::text !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'precontact email suppression event fingerprint is invalid' USING ERRCODE='22023';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'precontact email suppression occurrence time is required' USING ERRCODE='22023';
  END IF;

  target_fingerprint := public.email_precontact_identity_fingerprint(p_email);

  INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint)
  VALUES (target_fingerprint)
  ON CONFLICT (identity_fingerprint) DO NOTHING;

  PERFORM 1
  FROM lead_finder_private.email_contact_identities identity
  WHERE identity.identity_fingerprint=target_fingerprint
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'precontact email suppression identity is unavailable' USING ERRCODE='55000';
  END IF;

  SELECT * INTO existing
  FROM public.email_precontact_delivery_suppressions suppression
  WHERE suppression.event_fingerprint=p_event_fingerprint
  FOR UPDATE;

  IF FOUND THEN
    IF existing.identity_fingerprint IS DISTINCT FROM target_fingerprint
      OR existing.reason IS DISTINCT FROM normalized_reason
      OR existing.source IS DISTINCT FROM normalized_source
      OR existing.occurred_at IS DISTINCT FROM p_occurred_at
    THEN
      RAISE EXCEPTION 'precontact email suppression event fingerprint conflicts'
        USING ERRCODE='23505';
    END IF;

    RETURN QUERY SELECT existing.id,true,0;
    RETURN;
  END IF;

  INSERT INTO public.email_precontact_delivery_suppressions(
    identity_fingerprint,reason,source,event_fingerprint,occurred_at
  ) VALUES (
    target_fingerprint,normalized_reason,normalized_source,
    p_event_fingerprint,p_occurred_at
  )
  RETURNING * INTO inserted;

  UPDATE lead_finder_private.email_contact_identities identity
  SET suppressed=true,updated_at=clock_timestamp()
  WHERE identity.identity_fingerprint=target_fingerprint;

  UPDATE public.lead_contacts contact
  SET is_valid=false,updated_at=clock_timestamp()
  WHERE upper(contact.type)='EMAIL'
    AND contact.email_precontact_identity_fingerprint=target_fingerprint
    AND contact.is_valid;
  GET DIAGNOSTICS affected_rows=ROW_COUNT;

  RETURN QUERY SELECT inserted.id,false,affected_rows;
END
$function$;

REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
  text,text,text,char(64),timestamptz
) FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM anon;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM anon;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text)
      FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression()
      FROM lead_finder_api_runtime;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM lead_finder_api_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text)
      FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression()
      FROM lead_finder_contact_resolver_runtime;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM lead_finder_contact_resolver_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM service_role;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM service_role;
    GRANT EXECUTE ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) TO service_role;
  END IF;
END
$roles$;

COMMIT;
