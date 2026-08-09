import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const migrationName = '0048_precontact_email_delivery_suppression.sql';
const upgradeDatabaseName = `leadfinder_upgrade_0048_${process.pid}`;
const upgradeDatabaseUrl = new URL(databaseUrl);
upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`;

const legacyLeadId = randomUUID();
const legacyContactId = randomUUID();
const malformedLeadId = randomUUID();
const malformedContactId = randomUUID();
const rediscoveredLeadId = randomUUID();
const rediscoveredContactId = randomUUID();
const legacyEmail = 'legacy-hard-bounce@example.test';
const malformedEmail = 'legacy-malformed-email';
const legacyEventFingerprint = 'a'.repeat(64);
const occurredAt = new Date('2026-08-07T12:00:00.000Z');

const admin = postgres(databaseUrl, { max: 1 });
try {
  await admin.unsafe(`CREATE DATABASE "${upgradeDatabaseName}"`);
  const upgrade = postgres(upgradeDatabaseUrl.toString(), { max: 1 });
  try {
    for (const file of (await readdir(migrationDirectory))
      .filter((name) => name < migrationName)
      .sort()) {
      await upgrade.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));
    }

    await upgrade`
      INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed)
      VALUES
        (${legacyLeadId}::uuid,'node','upgrade-0048-legacy-bounce','Legacy bounce upgrade fixture','integration',1,'SEM_SITE_CADASTRADO',false),
        (${malformedLeadId}::uuid,'node','upgrade-0048-malformed','Malformed email upgrade fixture','integration',1,'SEM_SITE_CADASTRADO',false)
    `;

    await upgrade`
      INSERT INTO lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) VALUES
        (
          ${legacyContactId}::uuid,${legacyLeadId}::uuid,'EMAIL',
          ${legacyEmail},${legacyEmail},'INTEGRATION',1,now(),false,false
        ),
        (
          ${malformedContactId}::uuid,${malformedLeadId}::uuid,'EMAIL',
          ${malformedEmail},${malformedEmail},'INTEGRATION',1,now(),true,false
        )
    `;

    await upgrade`
      INSERT INTO contact_delivery_suppressions(
        contact_id,lead_id,channel,reason,source,event_fingerprint,occurred_at
      ) VALUES (
        ${legacyContactId}::uuid,${legacyLeadId}::uuid,'EMAIL','HARD_BOUNCE',
        'UPGRADE_TEST',${legacyEventFingerprint}::char(64),${occurredAt}::timestamptz
      )
    `;

    const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
    await upgrade.unsafe(migration);
    await upgrade.unsafe(migration);

    const malformed = (await upgrade<{
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

    const legacy = (await upgrade<{
      identity_fingerprint: string | null;
      suppressed: boolean;
    }[]>`
      SELECT c.email_precontact_identity_fingerprint identity_fingerprint,
        i.suppressed
      FROM lead_contacts c
      JOIN lead_finder_private.email_contact_identities i
        ON i.identity_fingerprint=c.email_precontact_identity_fingerprint
      WHERE c.id=${legacyContactId}::uuid
    `)[0]!;
    assert.match(legacy.identity_fingerprint ?? '', /^[0-9a-f]{64}$/);
    assert.equal(
      legacy.suppressed,
      true,
      'permanent delivery suppression from 0041 must seed global precontact suppression',
    );

    await upgrade`
      INSERT INTO leads(id,osm_type,osm_id,name,category,score,status,is_closed)
      VALUES (
        ${rediscoveredLeadId}::uuid,'node','upgrade-0048-rediscovered',
        'Rediscovered bounce upgrade fixture','integration',1,'SEM_SITE_CADASTRADO',false
      )
    `;
    await upgrade`
      INSERT INTO lead_contacts(
        id,lead_id,type,original_value,normalized_value,source,confidence,
        verified_at,is_valid,possible_whatsapp
      ) VALUES (
        ${rediscoveredContactId}::uuid,${rediscoveredLeadId}::uuid,'EMAIL',
        ${legacyEmail},${legacyEmail},'INTEGRATION',1,now(),true,false
      )
    `;

    const rediscovered = (await upgrade<{
      is_valid: boolean;
      identity_fingerprint: string | null;
    }[]>`
      SELECT is_valid,
        email_precontact_identity_fingerprint identity_fingerprint
      FROM lead_contacts
      WHERE id=${rediscoveredContactId}::uuid
    `)[0]!;
    assert.equal(rediscovered.is_valid, false, 'legacy hard bounce must block cross-lead rediscovery');
    assert.equal(rediscovered.identity_fingerprint, legacy.identity_fingerprint);

    console.log(JSON.stringify({
      result: 'MIGRATION_0048_UPGRADE_PASS',
      legacyPermanentSuppressionBackfill: 'PASS',
      malformedHistoricalEmailFailClosed: 'PASS',
      migrationReplay: 'PASS',
      crossLeadRediscovery: 'BLOCKED',
    }));
  } finally {
    await upgrade.end();
  }
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}"`);
  await admin.end();
}
