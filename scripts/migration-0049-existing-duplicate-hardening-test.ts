import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const migrationName = '0049_precontact_email_existing_duplicate_hardening.sql';
const databaseName = `leadfinder_upgrade_0049_${process.pid}`;
const databaseUrlForTest = new URL(databaseUrl);
databaseUrlForTest.pathname = `/${databaseName}`;
const occurredAt = new Date('2026-08-07T12:00:00.000Z');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const admin = postgres(databaseUrl, { max: 1 });
try {
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const sql = postgres(databaseUrlForTest.toString(), { max: 1 });
  try {
    for (const file of (await readdir(migrationDirectory))
      .filter((name) => name < migrationName)
      .sort()) {
      await sql.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));
    }

    const sharedEmail = `existing-duplicate-${randomUUID()}@example.test`;
    const leadA = randomUUID();
    const leadB = randomUUID();
    const contactA = randomUUID();
    const contactB = randomUUID();

    await sql`
      INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed)
      VALUES
        (${leadA}::uuid,'node',${`duplicate-a-${leadA}`},'Duplicate A','integration',1,'SEM_SITE_CADASTRADO',false),
        (${leadB}::uuid,'node',${`duplicate-b-${leadB}`},'Duplicate B','integration',1,'SEM_SITE_CADASTRADO',false)
    `;
    await sql`
      INSERT INTO lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) VALUES
        (${contactA}::uuid,${leadA}::uuid,'EMAIL',${sharedEmail},${sharedEmail},'INTEGRATION',1,now(),true,false),
        (${contactB}::uuid,${leadB}::uuid,'EMAIL',${sharedEmail},${sharedEmail},'INTEGRATION',1,now(),true,false)
    `;

    const binding = (await sql<{ fingerprint: string }[]>`
      SELECT contact_resolution_fingerprint fingerprint
      FROM lead_contacts WHERE id=${contactA}::uuid
    `)[0]!.fingerprint;
    const eventFingerprint = digest(`0049-preexisting:${sharedEmail}`);

    await sql`
      SELECT * FROM public.record_email_delivery_suppression(
        ${contactA}::uuid,
        ${leadA}::uuid,
        ${binding}::char(64),
        'HARD_BOUNCE',
        'UPGRADE_0049_TEST',
        ${eventFingerprint}::char(64),
        ${occurredAt}::timestamptz
      )
    `;

    const beforeHardening = await sql<{ id: string; is_valid: boolean }[]>`
      SELECT id,is_valid FROM lead_contacts
      WHERE id IN (${contactA}::uuid,${contactB}::uuid)
      ORDER BY id
    `;
    assert.equal(beforeHardening.length, 2);
    assert.equal(
      beforeHardening.find((row) => row.id === contactA)?.is_valid,
      false,
      '0048 invalidates the contact that reported the permanent failure',
    );
    assert.equal(
      beforeHardening.find((row) => row.id === contactB)?.is_valid,
      true,
      'fixture must reproduce the pre-existing duplicate gap before 0049',
    );

    const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
    await sql.unsafe(migration);
    await sql.unsafe(migration);

    const afterBackfill = await sql<{ is_valid: boolean; suppressed: boolean }[]>`
      SELECT contact.is_valid,identity.suppressed
      FROM lead_contacts contact
      JOIN lead_finder_private.email_contact_identities identity
        ON identity.identity_fingerprint=contact.email_precontact_identity_fingerprint
      WHERE contact.id IN (${contactA}::uuid,${contactB}::uuid)
    `;
    assert.equal(afterBackfill.length, 2);
    assert.equal(afterBackfill.every((row) => !row.is_valid && row.suppressed), true);

    const futureEmail = `future-duplicate-${randomUUID()}@example.test`;
    const futureLeadA = randomUUID();
    const futureLeadB = randomUUID();
    const futureLeadC = randomUUID();
    const futureContactA = randomUUID();
    const futureContactB = randomUUID();
    const futureContactC = randomUUID();

    await sql`
      INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed)
      VALUES
        (${futureLeadA}::uuid,'node',${`future-a-${futureLeadA}`},'Future A','integration',1,'SEM_SITE_CADASTRADO',false),
        (${futureLeadB}::uuid,'node',${`future-b-${futureLeadB}`},'Future B','integration',1,'SEM_SITE_CADASTRADO',false),
        (${futureLeadC}::uuid,'node',${`future-c-${futureLeadC}`},'Future C','integration',1,'SEM_SITE_CADASTRADO',false)
    `;
    await sql`
      INSERT INTO lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) VALUES
        (${futureContactA}::uuid,${futureLeadA}::uuid,'EMAIL',${futureEmail},${futureEmail},'INTEGRATION',1,now(),true,false),
        (${futureContactB}::uuid,${futureLeadB}::uuid,'EMAIL',${futureEmail},${futureEmail},'INTEGRATION',1,now(),true,false)
    `;

    const futureBinding = (await sql<{ fingerprint: string }[]>`
      SELECT contact_resolution_fingerprint fingerprint
      FROM lead_contacts WHERE id=${futureContactA}::uuid
    `)[0]!.fingerprint;
    const futureEvent = digest(`0049-future:${futureEmail}`);

    await sql`
      SELECT * FROM public.record_email_delivery_suppression(
        ${futureContactA}::uuid,
        ${futureLeadA}::uuid,
        ${futureBinding}::char(64),
        'INVALID_CONTACT',
        'UPGRADE_0049_TEST',
        ${futureEvent}::char(64),
        ${occurredAt}::timestamptz
      )
    `;

    const futureExisting = await sql<{ is_valid: boolean }[]>`
      SELECT is_valid FROM lead_contacts
      WHERE id IN (${futureContactA}::uuid,${futureContactB}::uuid)
    `;
    assert.equal(futureExisting.length, 2);
    assert.equal(
      futureExisting.every((row) => !row.is_valid),
      true,
      'a new permanent contact-bound event must invalidate every existing contact with that identity',
    );

    await sql`
      INSERT INTO lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) VALUES (
        ${futureContactC}::uuid,${futureLeadC}::uuid,'EMAIL',
        ${futureEmail},${futureEmail},'INTEGRATION',1,now(),true,false
      )
    `;
    assert.equal(
      (await sql<{ is_valid: boolean }[]>`
        SELECT is_valid FROM lead_contacts WHERE id=${futureContactC}::uuid
      `)[0]?.is_valid,
      false,
      'future cross-lead rediscovery must remain blocked by the suppressed identity',
    );

    console.log(JSON.stringify({
      result: 'MIGRATION_0049_EXISTING_DUPLICATE_HARDENING_PASS',
      preexistingDuplicateBackfill: 'PASS',
      futurePermanentEventInvalidatesAllExistingDuplicates: 'PASS',
      futureCrossLeadRediscovery: 'BLOCKED',
      migrationReplay: 'PASS',
    }));
  } finally {
    await sql.end();
  }
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
