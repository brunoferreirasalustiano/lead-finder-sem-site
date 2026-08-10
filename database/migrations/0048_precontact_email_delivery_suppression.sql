BEGIN;

-- Migration 0041 did not persist the email value or a deterministic email
-- identity with its contact-bound suppression rows. If permanent rows already
-- exist before 0048, the address that originally bounced cannot be proven from
-- the mutable lead_contacts row. Fail closed instead of suppressing a possibly
-- replacement address. Replays skip this gate because 0048 then has its own
-- immutable identity binding on every new permanent contact-bound event.
DO $historical$
DECLARE
  ambiguous_count bigint;
BEGIN
  IF to_regclass('public.email_precontact_delivery_suppressions') IS NULL THEN
    SELECT count(*)
    INTO ambiguous_count
    FROM public.contact_delivery_suppressions suppression
    WHERE suppression.channel='EMAIL'
      AND suppression.reason IN ('HARD_BOUNCE','INVALID_CONTACT');

    IF ambiguous_count > 0 THEN
      RAISE EXCEPTION
        'migration 0048 requires controlled reconciliation for % historical permanent email suppression(s)',
        ambiguous_count
        USING ERRCODE='55000';
    END IF;
  END IF;
END
$historical$;

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
SET search_path=pg_catalog, public
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

-- From 0048 onward every permanent contact-bound event stores the immutable
-- HMAC identity observed while its contact_resolution_fingerprint binding is
-- locked and verified. This makes future migration replays independent of the
-- mutable lead_contacts.normalized_value column.
ALTER TABLE public.contact_delivery_suppressions
  ADD COLUMN IF NOT EXISTS email_precontact_identity_fingerprint char(64);

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.contact_delivery_suppressions'::regclass
      AND conname='contact_delivery_suppressions_precontact_identity_format'
  ) THEN
    ALTER TABLE public.contact_delivery_suppressions
      ADD CONSTRAINT contact_delivery_suppressions_precontact_identity_format
      CHECK (
        email_precontact_identity_fingerprint IS NULL
        OR email_precontact_identity_fingerprint ~ '^[0-9a-f]{64}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.contact_delivery_suppressions'::regclass
      AND conname='contact_delivery_suppressions_permanent_identity_required'
  ) THEN
    ALTER TABLE public.contact_delivery_suppressions
      ADD CONSTRAINT contact_delivery_suppressions_permanent_identity_required
      CHECK (
        reason NOT IN ('HARD_BOUNCE','INVALID_CONTACT')
        OR email_precontact_identity_fingerprint IS NOT NULL
      );
  END IF;
END
$constraint$;

INSERT INTO lead_finder_private.email_contact_identities(
  identity_fingerprint,suppressed
)
SELECT DISTINCT
  suppression.email_precontact_identity_fingerprint,
  true
FROM public.contact_delivery_suppressions suppression
WHERE suppression.reason IN ('HARD_BOUNCE','INVALID_CONTACT')
  AND suppression.email_precontact_identity_fingerprint IS NOT NULL
ON CONFLICT (identity_fingerprint) DO UPDATE
SET suppressed=true,updated_at=clock_timestamp();

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.contact_delivery_suppressions'::regclass
      AND conname='contact_delivery_suppressions_precontact_identity_fk'
  ) THEN
    ALTER TABLE public.contact_delivery_suppressions
      ADD CONSTRAINT contact_delivery_suppressions_precontact_identity_fk
      FOREIGN KEY (email_precontact_identity_fingerprint)
      REFERENCES lead_finder_private.email_contact_identities(identity_fingerprint)
      ON DELETE RESTRICT;
  END IF;
END
$constraint$;

ALTER TABLE public.lead_contacts
  ADD COLUMN IF NOT EXISTS email_precontact_identity_fingerprint char(64);

-- Replays of this migration must be able to reconcile historical malformed
-- rows without the already-installed trigger trying to fingerprint them.
DROP TRIGGER IF EXISTS lead_contacts_email_precontact_suppression
  ON public.lead_contacts;

-- Pre-0048 schemas did not enforce EMAIL syntax. Preserve the historical row
-- but fail it closed and exclude it from the deterministic identity backfill.
UPDATE public.lead_contacts contact
SET is_valid=false,updated_at=clock_timestamp()
WHERE upper(contact.type)='EMAIL'
  AND (
    contact.normalized_value IS NULL
    OR btrim(contact.normalized_value)=''
    OR char_length(lower(btrim(contact.normalized_value))) NOT BETWEEN 3 AND 320
    OR lower(btrim(contact.normalized_value)) !~
      '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
  AND contact.is_valid;

INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint)
SELECT DISTINCT public.email_precontact_identity_fingerprint(contact.normalized_value)
FROM public.lead_contacts contact
WHERE upper(contact.type)='EMAIL'
  AND contact.normalized_value IS NOT NULL
  AND btrim(contact.normalized_value)<>''
  AND char_length(lower(btrim(contact.normalized_value))) BETWEEN 3 AND 320
  AND lower(btrim(contact.normalized_value)) ~
    '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
ON CONFLICT (identity_fingerprint) DO NOTHING;

UPDATE public.lead_contacts contact
SET email_precontact_identity_fingerprint=
  public.email_precontact_identity_fingerprint(contact.normalized_value)
WHERE upper(contact.type)='EMAIL'
  AND contact.normalized_value IS NOT NULL
  AND btrim(contact.normalized_value)<>''
  AND char_length(lower(btrim(contact.normalized_value))) BETWEEN 3 AND 320
  AND lower(btrim(contact.normalized_value)) ~
    '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  AND contact.email_precontact_identity_fingerprint IS NULL;

-- Only immutable bindings written by the post-0048 contact-bound recorder are
-- eligible for replay/backfill. Never derive a historical suppression from the
-- contact's current, mutable email value.
UPDATE lead_finder_private.email_contact_identities identity
SET suppressed=true,updated_at=clock_timestamp()
FROM public.contact_delivery_suppressions suppression
WHERE suppression.channel='EMAIL'
  AND suppression.reason IN ('HARD_BOUNCE','INVALID_CONTACT')
  AND suppression.email_precontact_identity_fingerprint IS NOT NULL
  AND identity.identity_fingerprint=
    suppression.email_precontact_identity_fingerprint
  AND NOT identity.suppressed;

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
SET search_path=pg_catalog, public
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
SET search_path=pg_catalog, public
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

  -- Suppression events are rare and security-sensitive. Serialize all writers
  -- of lead_contacts before taking an identity lock so a normal contact update
  -- can never hold contact->identity while this path holds identity->contact.
  LOCK TABLE public.lead_contacts IN SHARE ROW EXCLUSIVE MODE;

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

-- Preserve the established operational reconciler contract from migration 0041
-- while bridging every new permanent, contact-bound event into the global
-- pre-contact ledger. The verified resolution fingerprint proves the current
-- email binding at event time; that HMAC identity is persisted on the old ledger
-- so future replays never infer identity from a mutable contact row.
CREATE OR REPLACE FUNCTION public.record_email_delivery_suppression(
  p_contact_id uuid,
  p_lead_id uuid,
  p_contact_resolution_fingerprint char(64),
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
  target_identity char(64);
  existing_suppression public.contact_delivery_suppressions%ROWTYPE;
  inserted_suppression public.contact_delivery_suppressions%ROWTYPE;
  existing_global public.email_precontact_delivery_suppressions%ROWTYPE;
  affected_rows integer := 0;
  email_opt_out_exists boolean := false;
BEGIN
  IF p_contact_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'suppression target is required' USING ERRCODE='22023';
  END IF;
  IF btrim(p_contact_resolution_fingerprint::text) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'suppression contact binding is invalid' USING ERRCODE='22023';
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

  -- Same writer-serialization boundary as the pre-contact recorder. This lock
  -- is acquired before any contact or identity row lock, eliminating the mixed
  -- contact->identity / identity->contact deadlock cycle.
  LOCK TABLE public.lead_contacts IN SHARE ROW EXCLUSIVE MODE;

  -- Keep the legacy advisory order for compatibility after the table-level
  -- writer boundary has been established.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('manual-messaging:' || p_lead_id::text,0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('email-delivery-suppression:' || p_contact_id::text,0)
  );

  SELECT
    c.id,c.lead_id,c.type,c.is_valid,c.contact_resolution_fingerprint,
    c.normalized_value
  INTO target_contact
  FROM public.lead_contacts c
  WHERE c.id=p_contact_id AND c.lead_id=p_lead_id
  FOR UPDATE;

  IF NOT FOUND OR upper(target_contact.type) <> 'EMAIL' THEN
    RAISE EXCEPTION 'suppression target is not an email contact'
      USING ERRCODE='22023';
  END IF;
  IF target_contact.contact_resolution_fingerprint IS DISTINCT FROM
    lower(btrim(p_contact_resolution_fingerprint::text))
  THEN
    RAISE EXCEPTION 'suppression contact binding has changed'
      USING ERRCODE='40001';
  END IF;

  IF normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT') THEN
    target_identity := public.email_precontact_identity_fingerprint(
      target_contact.normalized_value
    );

    INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint)
    VALUES (target_identity)
    ON CONFLICT (identity_fingerprint) DO NOTHING;

    PERFORM 1
    FROM lead_finder_private.email_contact_identities identity
    WHERE identity.identity_fingerprint=target_identity
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'email suppression identity is unavailable'
        USING ERRCODE='55000';
    END IF;
  END IF;

  SELECT *
  INTO existing_suppression
  FROM public.contact_delivery_suppressions suppression
  WHERE suppression.event_fingerprint=p_event_fingerprint
  LIMIT 1
  FOR UPDATE;

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

    IF normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT') THEN
      IF existing_suppression.email_precontact_identity_fingerprint IS NULL THEN
        RAISE EXCEPTION 'historical suppression identity requires controlled reconciliation'
          USING ERRCODE='55000';
      END IF;
      IF existing_suppression.email_precontact_identity_fingerprint
        IS DISTINCT FROM target_identity
      THEN
        RAISE EXCEPTION 'suppression contact binding has changed'
          USING ERRCODE='40001';
      END IF;

      SELECT * INTO existing_global
      FROM public.email_precontact_delivery_suppressions global_suppression
      WHERE global_suppression.event_fingerprint=p_event_fingerprint
      FOR UPDATE;

      IF FOUND THEN
        IF existing_global.identity_fingerprint IS DISTINCT FROM target_identity
          OR existing_global.reason IS DISTINCT FROM normalized_reason
          OR existing_global.source IS DISTINCT FROM normalized_source
          OR existing_global.occurred_at IS DISTINCT FROM p_occurred_at
        THEN
          RAISE EXCEPTION 'precontact email suppression event fingerprint conflicts'
            USING ERRCODE='23505';
        END IF;
      ELSE
        INSERT INTO public.email_precontact_delivery_suppressions(
          identity_fingerprint,reason,source,event_fingerprint,occurred_at
        ) VALUES (
          target_identity,normalized_reason,normalized_source,
          p_event_fingerprint,p_occurred_at
        );
      END IF;

      UPDATE lead_finder_private.email_contact_identities identity
      SET suppressed=true,updated_at=clock_timestamp()
      WHERE identity.identity_fingerprint=target_identity;

      UPDATE public.lead_contacts
      SET is_valid=false,updated_at=clock_timestamp()
      WHERE id=p_contact_id AND lead_id=p_lead_id AND is_valid;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM public.campaign_opt_outs opt_out
      WHERE opt_out.lead_id=p_lead_id
        AND (opt_out.channel IS NULL OR opt_out.channel='EMAIL')
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
    contact_id,lead_id,channel,reason,source,event_fingerprint,occurred_at,
    email_precontact_identity_fingerprint
  ) VALUES (
    p_contact_id,p_lead_id,'EMAIL',normalized_reason,normalized_source,
    p_event_fingerprint,p_occurred_at,target_identity
  )
  RETURNING * INTO inserted_suppression;

  IF normalized_reason IN ('HARD_BOUNCE','INVALID_CONTACT') THEN
    SELECT * INTO existing_global
    FROM public.email_precontact_delivery_suppressions global_suppression
    WHERE global_suppression.event_fingerprint=p_event_fingerprint
    FOR UPDATE;

    IF FOUND THEN
      IF existing_global.identity_fingerprint IS DISTINCT FROM target_identity
        OR existing_global.reason IS DISTINCT FROM normalized_reason
        OR existing_global.source IS DISTINCT FROM normalized_source
        OR existing_global.occurred_at IS DISTINCT FROM p_occurred_at
      THEN
        RAISE EXCEPTION 'precontact email suppression event fingerprint conflicts'
          USING ERRCODE='23505';
      END IF;
    ELSE
      INSERT INTO public.email_precontact_delivery_suppressions(
        identity_fingerprint,reason,source,event_fingerprint,occurred_at
      ) VALUES (
        target_identity,normalized_reason,normalized_source,
        p_event_fingerprint,p_occurred_at
      );
    END IF;

    UPDATE lead_finder_private.email_contact_identities identity
    SET suppressed=true,updated_at=clock_timestamp()
    WHERE identity.identity_fingerprint=target_identity;

    UPDATE public.lead_contacts
    SET is_valid=false,updated_at=clock_timestamp()
    WHERE id=p_contact_id AND lead_id=p_lead_id AND is_valid;
    GET DIAGNOSTICS affected_rows=ROW_COUNT;
  END IF;

  IF normalized_reason IN ('OPT_OUT','COMPLAINT') THEN
    SELECT EXISTS(
      SELECT 1 FROM public.campaign_opt_outs opt_out
      WHERE opt_out.lead_id=p_lead_id
        AND (opt_out.channel IS NULL OR opt_out.channel='EMAIL')
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
  uuid,uuid,char(64),text,text,char(64),timestamptz
) FROM PUBLIC;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM anon;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM anon;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM anon;
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,char(64),text,text,char(64),timestamptz
    ) FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) FROM authenticated;
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,char(64),text,text,char(64),timestamptz
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
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,char(64),text,text,char(64),timestamptz
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
    REVOKE ALL ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,char(64),text,text,char(64),timestamptz
    ) FROM lead_finder_contact_resolver_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.email_precontact_identity_fingerprint(text) FROM service_role;
    REVOKE ALL ON FUNCTION public.enforce_email_precontact_suppression() FROM service_role;
    GRANT EXECUTE ON FUNCTION public.record_precontact_email_delivery_suppression(
      text,text,text,char(64),timestamptz
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_email_delivery_suppression(
      uuid,uuid,char(64),text,text,char(64),timestamptz
    ) TO service_role;
  END IF;
END
$roles$;

COMMIT;