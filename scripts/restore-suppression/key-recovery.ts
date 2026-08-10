import { createHash } from 'node:crypto';
import { connect, databaseUrl } from './db.js';
import type { SuppressionManifest } from './types.js';

const KEY_HEX_PATTERN = /^[0-9a-f]{64}$/u;

const keyDigest = (hex: string): string =>
  createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

const normalizeRecoveryKey = (value: string): string => {
  const normalized = value.trim();
  if (!KEY_HEX_PATTERN.test(normalized)) {
    throw new Error('PRECONTACT_HMAC_KEY_INPUT_INVALID');
  }
  return normalized;
};

export async function exportPrecontactHmacKey(
  url = databaseUrl(),
): Promise<{ keyHex: string; keyDigest: string }> {
  const sql = connect(url);
  try {
    const rows = await sql<{ secret_hex: string }[]>`
      SELECT encode(secret,'hex') secret_hex
      FROM lead_finder_private.email_suppression_hmac_key
      WHERE singleton=true
    `;
    if (rows.length !== 1 || !KEY_HEX_PATTERN.test(rows[0]!.secret_hex)) {
      throw new Error('PRECONTACT_HMAC_KEY_UNAVAILABLE');
    }
    const keyHex = rows[0]!.secret_hex;
    return { keyHex, keyDigest: keyDigest(keyHex) };
  } finally {
    await sql.end();
  }
}

export async function recoverPrecontactHmacKey(
  recoveryKey: string,
  manifest: SuppressionManifest,
  url = databaseUrl(),
): Promise<{ rekeyed: boolean; contactsRekeyed: number }> {
  const recoveredHex = normalizeRecoveryKey(recoveryKey);
  if (keyDigest(recoveredHex) !== manifest.precontactPermanent.keyDigest) {
    throw new Error('PRECONTACT_HMAC_KEY_RECOVERY_DIGEST_MISMATCH');
  }

  const sql = connect(url);
  let rekeyed = false;
  let contactsRekeyed = 0;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('restore-precontact-hmac-key',0))`;
      await tx.unsafe(`
        LOCK TABLE
          public.lead_contacts,
          public.contact_delivery_suppressions,
          public.email_precontact_delivery_suppressions,
          lead_finder_private.email_contact_identities,
          lead_finder_private.email_suppression_hmac_key
        IN SHARE ROW EXCLUSIVE MODE
      `);

      const current = await tx<{ key_digest: string }[]>`
        SELECT encode(extensions.digest(secret,'sha256'),'hex') key_digest
        FROM lead_finder_private.email_suppression_hmac_key
        WHERE singleton=true
      `;
      if (current.length !== 1) throw new Error('PRECONTACT_HMAC_KEY_UNAVAILABLE');
      if (current[0]!.key_digest === manifest.precontactPermanent.keyDigest) return;

      const unsafeState = await tx<{
        global_events: number;
        permanent_bindings: number;
        suppressed_identities: number;
      }[]>`
        SELECT
          (SELECT count(*)::int FROM public.email_precontact_delivery_suppressions) global_events,
          (
            SELECT count(*)::int
            FROM public.contact_delivery_suppressions
            WHERE channel='EMAIL'
              AND reason IN ('HARD_BOUNCE','INVALID_CONTACT')
              AND email_precontact_identity_fingerprint IS NOT NULL
          ) permanent_bindings,
          (
            SELECT count(*)::int
            FROM lead_finder_private.email_contact_identities
            WHERE suppressed
          ) suppressed_identities
      `;
      const state = unsafeState[0]!;
      if (state.global_events > 0 || state.permanent_bindings > 0 || state.suppressed_identities > 0) {
        throw new Error('PRECONTACT_HMAC_KEY_REKEY_UNSAFE');
      }

      const keyUpdated = await tx<{ singleton: boolean }[]>`
        UPDATE lead_finder_private.email_suppression_hmac_key
        SET secret=decode(${recoveredHex},'hex')
        WHERE singleton=true
        RETURNING singleton
      `;
      if (keyUpdated.length !== 1) throw new Error('PRECONTACT_HMAC_KEY_UNAVAILABLE');

      await tx`
        INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint,suppressed)
        SELECT DISTINCT public.email_precontact_identity_fingerprint(contact.normalized_value),false
        FROM public.lead_contacts contact
        WHERE upper(contact.type)='EMAIL'
          AND contact.normalized_value IS NOT NULL
          AND btrim(contact.normalized_value)<>''
          AND char_length(lower(btrim(contact.normalized_value))) BETWEEN 3 AND 320
          AND lower(btrim(contact.normalized_value)) ~
            '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
        ON CONFLICT (identity_fingerprint) DO NOTHING
      `;

      const changedContacts = await tx<{ id: string }[]>`
        UPDATE public.lead_contacts contact
        SET email_precontact_identity_fingerprint=
          public.email_precontact_identity_fingerprint(contact.normalized_value)
        WHERE upper(contact.type)='EMAIL'
          AND contact.normalized_value IS NOT NULL
          AND btrim(contact.normalized_value)<>''
          AND char_length(lower(btrim(contact.normalized_value))) BETWEEN 3 AND 320
          AND lower(btrim(contact.normalized_value)) ~
            '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
          AND contact.email_precontact_identity_fingerprint IS DISTINCT FROM
            public.email_precontact_identity_fingerprint(contact.normalized_value)
        RETURNING contact.id::text id
      `;
      contactsRekeyed = changedContacts.length;

      await tx`
        DELETE FROM lead_finder_private.email_contact_identities identity
        WHERE NOT identity.suppressed
          AND NOT EXISTS (
            SELECT 1 FROM public.lead_contacts contact
            WHERE contact.email_precontact_identity_fingerprint=identity.identity_fingerprint
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.contact_delivery_suppressions suppression
            WHERE suppression.email_precontact_identity_fingerprint=identity.identity_fingerprint
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.email_precontact_delivery_suppressions suppression
            WHERE suppression.identity_fingerprint=identity.identity_fingerprint
          )
      `;

      rekeyed = true;
    });
    return { rekeyed, contactsRekeyed };
  } finally {
    await sql.end();
  }
}
