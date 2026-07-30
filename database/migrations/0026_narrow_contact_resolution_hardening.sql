BEGIN;

DO $migration$
DECLARE
  pgcrypto_schema name;
  pgcrypto_relocatable boolean;
BEGIN
  SELECT namespace.nspname, extension.extrelocatable
  INTO pgcrypto_schema, pgcrypto_relocatable
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=extension.extnamespace
  WHERE extension.extname='pgcrypto';

  IF pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is required before narrow contact hardening';
  END IF;

  IF pgcrypto_schema <> 'extensions' THEN
    IF NOT pgcrypto_relocatable THEN
      RAISE EXCEPTION
        'pgcrypto outside extensions is not relocatable; controlled reconciliation is required';
    END IF;
    CREATE SCHEMA IF NOT EXISTS extensions;
    ALTER EXTENSION pgcrypto SET SCHEMA extensions;
  END IF;

  SELECT namespace.nspname
  INTO pgcrypto_schema
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=extension.extnamespace
  WHERE extension.extname='pgcrypto';

  IF pgcrypto_schema IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'pgcrypto must be normalized to the extensions schema';
  END IF;
END
$migration$;

ALTER TABLE public.lead_contacts
  ALTER COLUMN contact_resolution_fingerprint
    SET DEFAULT pg_catalog.encode(extensions.gen_random_bytes(32),'hex');

CREATE OR REPLACE FUNCTION public.rotate_contact_resolution_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.original_value IS DISTINCT FROM OLD.original_value
    OR NEW.normalized_value IS DISTINCT FROM OLD.normalized_value
  THEN
    NEW.contact_resolution_fingerprint :=
      pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  ELSE
    NEW.contact_resolution_fingerprint := OLD.contact_resolution_fingerprint;
  END IF;
  RETURN NEW;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contact_channel_authorizations'::regclass
      AND conname='contact_channel_authorizations_identity_unique'
  ) THEN
    ALTER TABLE public.contact_channel_authorizations
      ADD CONSTRAINT contact_channel_authorizations_identity_unique
      UNIQUE (id,contact_id,lead_id,purpose);
  END IF;
END
$$;

DO $$
DECLARE
  mismatch_count bigint;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM public.contact_channel_authorization_revocations revocation
  JOIN public.contact_channel_authorizations auth
    ON auth.id=revocation.authorization_id
  WHERE auth.contact_id IS DISTINCT FROM revocation.contact_id
     OR auth.lead_id IS DISTINCT FROM revocation.lead_id
     OR auth.purpose IS DISTINCT FROM revocation.purpose;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'contact authorization revocations contain % mismatched authorization tuple(s); controlled reconciliation is required',
      mismatch_count;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid='public.contact_channel_authorization_revocations'::regclass
      AND conname='contact_channel_authorization_revocations_authorization_identity_fk'
  ) THEN
    ALTER TABLE public.contact_channel_authorization_revocations
      ADD CONSTRAINT contact_channel_authorization_revocations_authorization_identity_fk
      FOREIGN KEY (authorization_id,contact_id,lead_id,purpose)
      REFERENCES public.contact_channel_authorizations(id,contact_id,lead_id,purpose)
      ON DELETE RESTRICT;
  END IF;
END
$$;

COMMIT;
