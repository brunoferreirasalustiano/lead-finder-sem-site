BEGIN;

-- Migration 0048 makes the HMAC identity authoritative for permanent email
-- failures. Close the remaining upgrade/runtime gap for duplicate contacts that
-- already existed before the identity became suppressed: every matching EMAIL
-- contact must fail closed, not only the contact that reported the bounce.
--
-- The runtime recorder from 0048 acquires SHARE ROW EXCLUSIVE on lead_contacts
-- before promoting the identity, so the trigger below runs behind the same
-- writer-serialization boundary and does not reintroduce contact/identity lock
-- inversion.
LOCK TABLE public.lead_contacts IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.lead_contacts contact
SET is_valid=false,updated_at=clock_timestamp()
FROM lead_finder_private.email_contact_identities identity
WHERE identity.suppressed
  AND contact.email_precontact_identity_fingerprint=identity.identity_fingerprint
  AND upper(contact.type)='EMAIL'
  AND contact.is_valid;

CREATE OR REPLACE FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
BEGIN
  IF NEW.channel='EMAIL'
    AND NEW.reason IN ('HARD_BOUNCE','INVALID_CONTACT')
    AND NEW.email_precontact_identity_fingerprint IS NOT NULL
  THEN
    -- The canonical 0048 recorder invalidates NEW.contact_id immediately after
    -- this AFTER INSERT trigger returns and uses that UPDATE row count as part
    -- of its established contact_invalidated result contract. This trigger is
    -- responsible for the other already-existing contacts that share the same
    -- immutable identity; excluding the reporting contact avoids consuming the
    -- target transition before the recorder can report it.
    UPDATE public.lead_contacts contact
    SET is_valid=false,updated_at=clock_timestamp()
    WHERE upper(contact.type)='EMAIL'
      AND contact.id IS DISTINCT FROM NEW.contact_id
      AND contact.email_precontact_identity_fingerprint=
        NEW.email_precontact_identity_fingerprint
      AND contact.is_valid;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS contact_delivery_suppressions_invalidate_existing_email_contacts
  ON public.contact_delivery_suppressions;
CREATE TRIGGER contact_delivery_suppressions_invalidate_existing_email_contacts
AFTER INSERT ON public.contact_delivery_suppressions
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression();

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
      FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
      FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
      FROM service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_api_runtime') THEN
    REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
      FROM lead_finder_api_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lead_finder_contact_resolver_runtime') THEN
    REVOKE ALL ON FUNCTION public.invalidate_existing_email_contacts_for_delivery_suppression()
      FROM lead_finder_contact_resolver_runtime;
  END IF;
END
$roles$;

COMMIT;