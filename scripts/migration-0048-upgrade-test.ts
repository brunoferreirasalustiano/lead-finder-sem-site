import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const migrationName = '0048_precontact_email_delivery_suppression.sql';
const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const occurredAt = new Date('2026-08-07T12:00:00.000Z');
const admin = postgres(databaseUrl, { max: 1 });

const applyPre0048 = async (sql: ReturnType<typeof postgres>) => {
  for (const file of (await readdir(migrationDirectory))
    .filter((name) => name < migrationName)
    .sort()) {
    await sql.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));
  }
};

const createDatabase = async (name: string) => {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return { sql: postgres(url.toString(), { max: 1 }), url: url.toString() };
};

const dropDatabase = async (name: string) => {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
};

const insertLead = async (
  sql: ReturnType<typeof postgres>,
  id: string,
  osmId: string,
  name: string,
) => {
  await sql`
    INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed)
    VALUES (
      ${id}::uuid,'node',${osmId},${name},'integration',1,
      'SEM_SITE_CADASTRADO',false
    )
  `;
};

const insertEmailContact = async (
  sql: ReturnType<typeof postgres>,
  id: string,
  leadId: string,
  email: string,
  isValid = true,
) => {
  await sql`
    INSERT INTO lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid,possible_whatsapp
    ) VALUES (
      ${id}::uuid,${leadId}::uuid,'EMAIL',${email},${email},
      'INTEGRATION',1,now(),${isValid},false
    )
  `;
};

try {
  // A pre-0048 permanent suppression cannot be mapped safely because 0041 did
  // not persist the email identity and 0026 allows the contact value to rotate.
  // Prove the migration refuses to infer the historical address from the
  // contact's current value.
  const ambiguousDatabaseName = `leadfinder_upgrade_0048_ambiguous_${process.pid}`;
  const ambiguous = await createDatabase(ambiguousDatabaseName);
  try {
    await applyPre0048(ambiguous.sql);

    const leadId = randomUUID();
    const contactId = randomUUID();
    const bouncedEmail = 'legacy-hard-bounce@example.test';
    const replacementEmail = 'replacement-after-bounce@example.test';
    const eventFingerprint = digest('upgrade-0048-ambiguous-hard-bounce');

    await insertLead(
      ambiguous.sql,
      leadId,
      'upgrade-0048-ambiguous',
      'Ambiguous historical suppression fixture',
    );
    await insertEmailContact(ambiguous.sql, contactId, leadId, bouncedEmail);

    const binding = (await ambiguous.sql<{ fingerprint: string }[]>`
      SELECT contact_resolution_fingerprint fingerprint
      FROM lead_contacts
      WHERE id=${contactId}::uuid
    `)[0]!.fingerprint;

    await ambiguous.sql`
      SELECT * FROM public.record_email_delivery_suppression(
        ${contactId}::uuid,
        ${leadId}::uuid,
        ${binding}::char(64),
        'HARD_BOUNCE',
        'UPGRADE_TEST',
        ${eventFingerprint}::char(64),
        ${occurredAt}::timestamptz
      )
    `;

    await ambiguous.sql`
      UPDATE lead_contacts
      SET original_value=${replacementEmail},
          normalized_value=${replacementEmail},
          is_valid=true
      WHERE id=${contactId}::uuid
    `;

    await assert.rejects(
      () => ambiguous.sql.unsafe(migration),
      (error: unknown) =>
        error instanceof Error
        && error.message.includes('requires controlled reconciliation for 1 historical permanent email suppression'),
    );
    await ambiguous.sql.unsafe('ROLLBACK').catch(() => undefined);

    const globalLedger = (await ambiguous.sql<{ relation: string | null }[]>`
      SELECT to_regclass('public.email_precontact_delivery_suppressions')::text relation
    `)[0]?.relation;
    assert.equal(globalLedger, null, 'failed upgrade must not leave a partial 0048 schema');
  } finally {
    await ambiguous.sql.end();
    await dropDatabase(ambiguousDatabaseName);
  }

  // Clean upgrade: malformed legacy EMAILs fail closed, then every permanent
  // event recorded through the established 0041 operational function must also
  // create the immutable global identity/ledger state introduced by 0048.
  const cleanDatabaseName = `leadfinder_upgrade_0048_clean_${process.pid}`;
  const clean = await createDatabase(cleanDatabaseName);
  try {
    await applyPre0048(clean.sql);

    const malformedLeadId = randomUUID();
    const malformedContactId = randomUUID();
    const operationalLeadId = randomUUID();
    const operationalContactId = randomUUID();
    const malformedEmail = 'legacy-malformed-email';
    const bouncedEmail = 'operational-hard-bounce@example.test';
    const replacementEmail = 'operational-replacement@example.test';
    const eventFingerprint = digest('upgrade-0048-operational-hard-bounce');

    await insertLead(
      clean.sql,
      malformedLeadId,
      'upgrade-0048-malformed',
      'Malformed email upgrade fixture',
    );
    await insertLead(
      clean.sql,
      operationalLeadId,
      'upgrade-0048-operational',
      'Operational suppression bridge fixture',
    );
    await insertEmailContact(
      clean.sql,
      malformedContactId,
      malformedLeadId,
      malformedEmail,
    );
    await insertEmailContact(
      clean.sql,
      operationalContactId,
      operationalLeadId,
      bouncedEmail,
    );

    await clean.sql.unsafe(migration);

    const malformed = (await clean.sql<{
      is_valid: boolean;
      identity_fingerprint: string | null;
    }[]>`
      SELECT is_valid,
        email_precontact_identity_fingerprint identity_fingerprint
      FROM lead_contacts
      WHERE id=${malformedContactId}::uuid
    `)[0]!;
    assert.equal(malformed.is_valid, false, 'malformed historical EMAIL must fail closed');
    assert.equal(
      malformed.identity_fingerprint,
      null,
      'malformed historical EMAIL must not enter the HMAC identity set',
    );

    const operationalBinding = (await clean.sql<{ fingerprint: string }[]>`
      SELECT contact_resolution_fingerprint fingerprint
      FROM lead_contacts
      WHERE id=${operationalContactId}::uuid
    `)[0]!.fingerprint;

    const firstOperational = (await clean.sql<{
      replayed: boolean;
      contact_invalidated: boolean;
    }[]>`
      SELECT replayed,contact_invalidated
      FROM public.record_email_delivery_suppression(
        ${operationalContactId}::uuid,
        ${operationalLeadId}::uuid,
        ${operationalBinding}::char(64),
        'HARD_BOUNCE',
        'UPGRADE_TEST',
        ${eventFingerprint}::char(64),
        ${occurredAt}::timestamptz
      )
    `)[0]!;
    assert.equal(firstOperational.replayed, false);
    assert.equal(firstOperational.contact_invalidated, true);

    const replayOperational = (await clean.sql<{ replayed: boolean }[]>`
      SELECT replayed
      FROM public.record_email_delivery_suppression(
        ${operationalContactId}::uuid,
        ${operationalLeadId}::uuid,
        ${operationalBinding}::char(64),
        'HARD_BOUNCE',
        'UPGRADE_TEST',
        ${eventFingerprint}::char(64),
        ${occurredAt}::timestamptz
      )
    `)[0]!;
    assert.equal(replayOperational.replayed, true);

    const immutableBinding = (await clean.sql<{
      identity_fingerprint: string;
      suppressed: boolean;
      global_count: number;
    }[]>`
      SELECT
        suppression.email_precontact_identity_fingerprint identity_fingerprint,
        identity.suppressed,
        (
          SELECT count(*)::int
          FROM email_precontact_delivery_suppressions global_suppression
          WHERE global_suppression.event_fingerprint=${eventFingerprint}::char(64)
        ) global_count
      FROM contact_delivery_suppressions suppression
      JOIN lead_finder_private.email_contact_identities identity
        ON identity.identity_fingerprint=
          suppression.email_precontact_identity_fingerprint
      WHERE suppression.event_fingerprint=${eventFingerprint}::char(64)
    `)[0]!;
    assert.match(immutableBinding.identity_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(immutableBinding.suppressed, true);
    assert.equal(immutableBinding.global_count, 1);

    const rediscoveredLeadId = randomUUID();
    const rediscoveredContactId = randomUUID();
    await insertLead(
      clean.sql,
      rediscoveredLeadId,
      'upgrade-0048-rediscovered',
      'Cross-lead rediscovery fixture',
    );
    await insertEmailContact(
      clean.sql,
      rediscoveredContactId,
      rediscoveredLeadId,
      bouncedEmail,
    );
    assert.equal(
      (await clean.sql<{ is_valid: boolean }[]>`
        SELECT is_valid FROM lead_contacts WHERE id=${rediscoveredContactId}::uuid
      `)[0]!.is_valid,
      false,
      'post-upgrade contact-bound hard bounce must block cross-lead rediscovery',
    );

    // Changing the original contact after the event creates a new identity.
    // Reapplying 0048 must retain suppression on the immutable old identity and
    // must not infer/suppress the replacement address.
    await clean.sql`
      UPDATE lead_contacts
      SET original_value=${replacementEmail},
          normalized_value=${replacementEmail},
          is_valid=true
      WHERE id=${operationalContactId}::uuid
    `;
    const replacementBinding = (await clean.sql<{
      resolution_fingerprint: string;
      identity_fingerprint: string;
      is_valid: boolean;
    }[]>`
      SELECT
        contact_resolution_fingerprint resolution_fingerprint,
        email_precontact_identity_fingerprint identity_fingerprint,
        is_valid
      FROM lead_contacts
      WHERE id=${operationalContactId}::uuid
    `)[0]!;
    assert.notEqual(replacementBinding.identity_fingerprint, immutableBinding.identity_fingerprint);
    assert.equal(replacementBinding.is_valid, true);

    await clean.sql.unsafe(migration);

    const identityStates = await clean.sql<{
      identity_fingerprint: string;
      suppressed: boolean;
    }[]>`
      SELECT identity_fingerprint,suppressed
      FROM lead_finder_private.email_contact_identities
      WHERE identity_fingerprint IN (
        ${immutableBinding.identity_fingerprint}::char(64),
        ${replacementBinding.identity_fingerprint}::char(64)
      )
      ORDER BY identity_fingerprint
    `;
    const oldIdentity = identityStates.find(
      (row) => row.identity_fingerprint === immutableBinding.identity_fingerprint,
    );
    const replacementIdentity = identityStates.find(
      (row) => row.identity_fingerprint === replacementBinding.identity_fingerprint,
    );
    assert.equal(oldIdentity?.suppressed, true);
    assert.equal(replacementIdentity?.suppressed, false);

    await assert.rejects(
      () => clean.sql`
        SELECT * FROM public.record_email_delivery_suppression(
          ${operationalContactId}::uuid,
          ${operationalLeadId}::uuid,
          ${replacementBinding.resolution_fingerprint}::char(64),
          'HARD_BOUNCE',
          'UPGRADE_TEST',
          ${eventFingerprint}::char(64),
          ${occurredAt}::timestamptz
        )
      `,
      (error: unknown) =>
        error instanceof Error && error.message.includes('suppression contact binding has changed'),
    );

    const replacementLeadId = randomUUID();
    const replacementContactId = randomUUID();
    await insertLead(
      clean.sql,
      replacementLeadId,
      'upgrade-0048-replacement',
      'Replacement address fixture',
    );
    await insertEmailContact(
      clean.sql,
      replacementContactId,
      replacementLeadId,
      replacementEmail,
    );
    assert.equal(
      (await clean.sql<{ is_valid: boolean }[]>`
        SELECT is_valid FROM lead_contacts WHERE id=${replacementContactId}::uuid
      `)[0]!.is_valid,
      true,
      'migration replay must not suppress a mutable replacement address',
    );

    // Mixed operational/pre-contact permanent failures for the same identity
    // must serialize rather than deadlock. Both functions acquire the same
    // writer boundary before any contact/identity row lock.
    const concurrentLeadId = randomUUID();
    const concurrentContactId = randomUUID();
    const concurrentEmail = 'concurrent-suppression@example.test';
    const contactEvent = digest('upgrade-0048-concurrent-contact');
    const precontactEvent = digest('upgrade-0048-concurrent-precontact');
    await insertLead(
      clean.sql,
      concurrentLeadId,
      'upgrade-0048-concurrent',
      'Concurrent suppression fixture',
    );
    await insertEmailContact(
      clean.sql,
      concurrentContactId,
      concurrentLeadId,
      concurrentEmail,
    );
    const concurrentBinding = (await clean.sql<{ fingerprint: string }[]>`
      SELECT contact_resolution_fingerprint fingerprint
      FROM lead_contacts WHERE id=${concurrentContactId}::uuid
    `)[0]!.fingerprint;

    const clientA = postgres(clean.url, { max: 1 });
    const clientB = postgres(clean.url, { max: 1 });
    try {
      await clientA.unsafe("SET statement_timeout='5000ms'");
      await clientB.unsafe("SET statement_timeout='5000ms'");
      const [contactResult, precontactResult] = await Promise.all([
        clientA`
          SELECT * FROM public.record_email_delivery_suppression(
            ${concurrentContactId}::uuid,
            ${concurrentLeadId}::uuid,
            ${concurrentBinding}::char(64),
            'HARD_BOUNCE',
            'UPGRADE_CONCURRENCY_A',
            ${contactEvent}::char(64),
            ${occurredAt}::timestamptz
          )
        `,
        clientB`
          SELECT * FROM public.record_precontact_email_delivery_suppression(
            ${concurrentEmail},
            'INVALID_CONTACT',
            'UPGRADE_CONCURRENCY_B',
            ${precontactEvent}::char(64),
            ${occurredAt}::timestamptz
          )
        `,
      ]);
      assert.equal(contactResult.length, 1);
      assert.equal(precontactResult.length, 1);
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const concurrentFinal = (await clean.sql<{
      is_valid: boolean;
      suppression_count: number;
    }[]>`
      SELECT contact.is_valid,
        (
          SELECT count(*)::int
          FROM email_precontact_delivery_suppressions suppression
          WHERE suppression.event_fingerprint IN (
            ${contactEvent}::char(64),${precontactEvent}::char(64)
          )
        ) suppression_count
      FROM lead_contacts contact
      WHERE contact.id=${concurrentContactId}::uuid
    `)[0]!;
    assert.equal(concurrentFinal.is_valid, false);
    assert.equal(concurrentFinal.suppression_count, 2);

    console.log(JSON.stringify({
      result: 'MIGRATION_0048_UPGRADE_PASS',
      ambiguousHistoricalBinding: 'FAIL_CLOSED',
      malformedHistoricalEmailFailClosed: 'PASS',
      operationalRecorderBridge: 'PASS',
      immutableHistoricalBinding: 'PASS',
      migrationReplay: 'PASS',
      crossLeadRediscovery: 'BLOCKED',
      replacementAddressInference: 'BLOCKED',
      mixedSuppressionConcurrency: 'PASS',
    }));
  } finally {
    await clean.sql.end();
    await dropDatabase(cleanDatabaseName);
  }
} finally {
  await admin.end();
}
