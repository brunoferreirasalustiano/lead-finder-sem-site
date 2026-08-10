import { createHash } from 'node:crypto';
import { connect, databaseUrl } from './db.js';
import type { PrecontactPermanentEvent, SuppressionManifest } from './types.js';

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

const eventMap = (manifest: SuppressionManifest): Map<string, PrecontactPermanentEvent> => {
  const result = new Map<string, PrecontactPermanentEvent>();
  for (const event of manifest.precontactPermanent.events) {
    if (result.has(event.eventFingerprint)) {
      throw new Error('PRE0048_LEGACY_MANIFEST_CONFLICT');
    }
    result.set(event.eventFingerprint,event);
  }
  return result;
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

export async function prepareLegacyPre0048Restore(
  recoveryKey: string,
  manifest: SuppressionManifest,
  url = databaseUrl(),
): Promise<{ prepared: boolean; legacyEvents: number }> {
  const recoveredHex = normalizeRecoveryKey(recoveryKey);
  if (keyDigest(recoveredHex) !== manifest.precontactPermanent.keyDigest) {
    throw new Error('PRECONTACT_HMAC_KEY_RECOVERY_DIGEST_MISMATCH');
  }
  const events = eventMap(manifest);
  const suppressedFingerprints = new Set(manifest.precontactPermanent.fingerprints);
  const sql = connect(url);
  let prepared = false;
  let legacyEvents = 0;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('restore-pre0048-legacy-suppression',0))`;
      const relations = await tx<{
        global_ledger: string | null;
        contact_ledger: string | null;
        private_key: string | null;
        private_identities: string | null;
      }[]>`
        SELECT
          to_regclass('public.email_precontact_delivery_suppressions')::text global_ledger,
          to_regclass('public.contact_delivery_suppressions')::text contact_ledger,
          to_regclass('lead_finder_private.email_suppression_hmac_key')::text private_key,
          to_regclass('lead_finder_private.email_contact_identities')::text private_identities
      `;
      const relation = relations[0]!;
      if (relation.global_ledger) return;
      if (!relation.contact_ledger) return;
      if (relation.private_key || relation.private_identities) {
        throw new Error('PRE0048_LEGACY_BOOTSTRAP_CONFLICT');
      }

      await tx.unsafe('LOCK TABLE public.contact_delivery_suppressions, public.lead_contacts IN SHARE ROW EXCLUSIVE MODE');
      const legacy = await tx<{
        id: string;
        reason: 'HARD_BOUNCE'|'INVALID_CONTACT';
        source: string;
        event_fingerprint: string;
        occurred_at: Date;
      }[]>`
        SELECT id::text,reason,source,event_fingerprint::text event_fingerprint,occurred_at
        FROM public.contact_delivery_suppressions
        WHERE channel='EMAIL' AND reason IN ('HARD_BOUNCE','INVALID_CONTACT')
        ORDER BY event_fingerprint
        FOR UPDATE
      `;
      legacyEvents = legacy.length;
      if (legacy.length === 0) return;
      if (legacy.length > 100_000) throw new Error('PRE0048_LEGACY_SUPPRESSION_LIMIT_EXCEEDED');

      const mappings: Array<{
        eventFingerprint: string;
        identityFingerprint: string;
        reasonCode: 'HARD_BOUNCE'|'INVALID_CONTACT';
        operationalSource: string;
        occurredAt: string;
      }> = [];
      for (const row of legacy) {
        const event = events.get(row.event_fingerprint);
        if (!event
          || event.reasonCode !== row.reason
          || event.operationalSource !== row.source
          || event.occurredAt !== row.occurred_at.toISOString()
          || !suppressedFingerprints.has(event.identityFingerprint)) {
          throw new Error('PRE0048_LEGACY_SUPPRESSION_UNRESOLVED');
        }
        mappings.push(event);
      }

      await tx.unsafe(`
        CREATE SCHEMA lead_finder_private;
        REVOKE ALL ON SCHEMA lead_finder_private FROM PUBLIC;
        CREATE TABLE lead_finder_private.email_suppression_hmac_key (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          secret bytea NOT NULL CHECK (octet_length(secret)=32),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        REVOKE ALL ON TABLE lead_finder_private.email_suppression_hmac_key FROM PUBLIC;
        CREATE TABLE lead_finder_private.email_contact_identities (
          identity_fingerprint char(64) PRIMARY KEY CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
          suppressed boolean NOT NULL DEFAULT false,
          first_seen_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        REVOKE ALL ON TABLE lead_finder_private.email_contact_identities FROM PUBLIC;
        ALTER TABLE public.contact_delivery_suppressions
          ADD COLUMN email_precontact_identity_fingerprint char(64);
      `);
      await tx`
        INSERT INTO lead_finder_private.email_suppression_hmac_key(singleton,secret)
        VALUES(true,decode(${recoveredHex},'hex'))
      `;

      const identities = [...new Set(mappings.map((mapping) => mapping.identityFingerprint))];
      await tx`
        INSERT INTO lead_finder_private.email_contact_identities(identity_fingerprint,suppressed)
        SELECT value::char(64),true
        FROM jsonb_array_elements_text(${tx.json(identities)}::jsonb)
      `;

      // The legacy row already carries an append-only audit record. The
      // bridge adds only the recovered identity binding inside this
      // transaction; keep the trigger disabled for this single controlled
      // update and restore it before the transaction can commit. Any failure
      // rolls the transaction back, which also restores the trigger state.
      await tx.unsafe(
        'ALTER TABLE public.contact_delivery_suppressions DISABLE TRIGGER contact_delivery_suppressions_append_only',
      );
      const changed = await tx<{ id: string }[]>`
        UPDATE public.contact_delivery_suppressions suppression
        SET email_precontact_identity_fingerprint=(mapping->>'identityFingerprint')::char(64)
        FROM jsonb_array_elements(${tx.json(mappings)}::jsonb) mapping
        WHERE suppression.event_fingerprint::text=mapping->>'eventFingerprint'
          AND suppression.channel='EMAIL'
          AND suppression.reason IN ('HARD_BOUNCE','INVALID_CONTACT')
          AND suppression.email_precontact_identity_fingerprint IS NULL
        RETURNING suppression.id::text id
      `;
      await tx.unsafe(
        'ALTER TABLE public.contact_delivery_suppressions ENABLE TRIGGER contact_delivery_suppressions_append_only',
      );
      if (changed.length !== legacy.length) {
        throw new Error('PRE0048_LEGACY_SUPPRESSION_RECONCILIATION_MISMATCH');
      }

      await tx.unsafe(`
        CREATE TABLE public.email_precontact_delivery_suppressions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          identity_fingerprint char(64) NOT NULL CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),
          reason text NOT NULL CHECK (reason IN ('HARD_BOUNCE','INVALID_CONTACT')),
          source text NOT NULL CHECK (
            char_length(source) BETWEEN 1 AND 64
            AND source ~ '^[A-Z][A-Z0-9_]*$'
          ),
          event_fingerprint char(64) NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
          occurred_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY (identity_fingerprint)
            REFERENCES lead_finder_private.email_contact_identities(identity_fingerprint)
            ON DELETE RESTRICT,
          UNIQUE (event_fingerprint)
        );
        REVOKE ALL ON TABLE public.email_precontact_delivery_suppressions FROM PUBLIC;
      `);
      await tx`
        INSERT INTO public.email_precontact_delivery_suppressions(
          identity_fingerprint,reason,source,event_fingerprint,occurred_at
        )
        SELECT
          (entry->>'identityFingerprint')::char(64),
          entry->>'reasonCode',
          entry->>'operationalSource',
          (entry->>'eventFingerprint')::char(64),
          (entry->>'occurredAt')::timestamptz
        FROM jsonb_array_elements(${tx.json(mappings)}::jsonb) entry
      `;

      const proof = await tx<{ mapped: number; global_events: number; key_digest: string }[]>`
        SELECT
          (SELECT count(*)::int
           FROM public.contact_delivery_suppressions
           WHERE channel='EMAIL'
             AND reason IN ('HARD_BOUNCE','INVALID_CONTACT')
             AND email_precontact_identity_fingerprint IS NOT NULL) mapped,
          (SELECT count(*)::int FROM public.email_precontact_delivery_suppressions) global_events,
          (SELECT encode(extensions.digest(secret,'sha256'),'hex')
           FROM lead_finder_private.email_suppression_hmac_key WHERE singleton=true) key_digest
      `;
      if (proof.length !== 1
        || proof[0]!.mapped !== legacy.length
        || proof[0]!.global_events !== legacy.length
        || proof[0]!.key_digest !== manifest.precontactPermanent.keyDigest) {
        throw new Error('PRE0048_LEGACY_SUPPRESSION_RECONCILIATION_MISMATCH');
      }
      prepared = true;
    });
    return { prepared, legacyEvents };
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
