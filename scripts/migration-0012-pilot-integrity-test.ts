import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const migrationName = '0012_pilot_referential_integrity.sql';
const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
const admin = postgres(databaseUrl, { max: 1 });

type Fixture = {
  runId: string;
  associatedLeadId: string;
  associatedContactId: string;
  otherLeadId: string;
  otherContactId: string;
};

const applyBefore0012 = async (sql: Sql) => {
  for (const file of (await readdir(migrationDirectory)).filter((name) => name < migrationName).sort())
    await sql.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));
};

const apply0012 = (sql: Sql) => sql.begin(async (transaction) => {
  await transaction.unsafe(migration);
});

const createFixture = async (sql: Sql): Promise<Fixture> => {
  const runId = randomUUID();
  const associatedLeadId = randomUUID();
  const associatedContactId = randomUUID();
  const otherLeadId = randomUUID();
  const otherContactId = randomUUID();
  await sql`
    INSERT INTO leads (id, osm_type, osm_id, category, score, status)
    VALUES
      (${associatedLeadId}::uuid, 'node', ${`integrity-associated-${associatedLeadId}`}, 'SYNTHETIC', 1, 'SEM_SITE_CADASTRADO'),
      (${otherLeadId}::uuid, 'node', ${`integrity-other-${otherLeadId}`}, 'SYNTHETIC', 1, 'SEM_SITE_CADASTRADO')`;
  await sql`
    INSERT INTO lead_contacts (id, lead_id, type, original_value, normalized_value, source, confidence, verified_at, is_valid)
    VALUES
      (${associatedContactId}::uuid, ${associatedLeadId}::uuid, 'EMAIL', ${`${associatedLeadId}@example.invalid`}, ${`${associatedLeadId}@example.invalid`}, 'SYNTHETIC', 1, now(), true),
      (${otherContactId}::uuid, ${otherLeadId}::uuid, 'EMAIL', ${`${otherLeadId}@example.invalid`}, ${`${otherLeadId}@example.invalid`}, 'SYNTHETIC', 1, now(), true)`;
  await sql`
    INSERT INTO pilot_runs (id, name, region, category, target_lead_count, created_by)
    VALUES (${runId}::uuid, 'Integrity fixture', 'Synthetic region', 'SYNTHETIC', 1, 'migration-test')`;
  await sql`
    INSERT INTO pilot_leads (pilot_run_id, lead_id, source, added_by)
    VALUES (${runId}::uuid, ${associatedLeadId}::uuid, 'SYNTHETIC', 'migration-test')`;
  return { runId, associatedLeadId, associatedContactId, otherLeadId, otherContactId };
};

const expectConstraint = async (operation: Promise<unknown>, constraint: string) => {
  await assert.rejects(operation, (error: unknown) => {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; constraint_name?: unknown };
    return (candidate.code === '23503' || candidate.code === '23514') && candidate.constraint_name === constraint;
  });
};

const withDatabase = async (label: string, test: (sql: Sql) => Promise<void>) => {
  const databaseName = `leadfinder_0012_${label}_${process.pid}`;
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const sql = postgres(url.toString(), { max: 1 });
  try {
    await test(sql);
  } finally {
    await sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
  }
};

try {
  await withDatabase('empty', async (sql) => {
    await applyBefore0012(sql);
    await apply0012(sql);
    await apply0012(sql);
  });

  await withDatabase('valid_preexisting', async (sql) => {
    await applyBefore0012(sql);
    const fixture = await createFixture(sql);
    await sql`
      INSERT INTO pilot_timeline_events (pilot_run_id, lead_id, event_type, principal_id, new_value)
      VALUES (${fixture.runId}::uuid, NULL, 'RUN_EVENT', 'migration-test', '{}'::jsonb)`;

    await apply0012(sql);
    await apply0012(sql);

    await sql`
      INSERT INTO pilot_manual_contacts (
        pilot_run_id, lead_id, contact_id, channel, approved_template_version_id,
        operator_principal_id, idempotency_key, payload_fingerprint
      ) VALUES (
        ${fixture.runId}::uuid, ${fixture.associatedLeadId}::uuid, ${fixture.associatedContactId}::uuid,
        'EMAIL_MANUAL', 'template-v1', 'migration-test', 'valid-contact', ${'1'.repeat(64)}
      )`;
    await expectConstraint(sql`
      INSERT INTO pilot_manual_contacts (
        pilot_run_id, lead_id, contact_id, channel, approved_template_version_id,
        operator_principal_id, idempotency_key, payload_fingerprint
      ) VALUES (
        ${fixture.runId}::uuid, ${fixture.associatedLeadId}::uuid, ${fixture.otherContactId}::uuid,
        'EMAIL_MANUAL', 'template-v1', 'migration-test', 'cross-contact', ${'2'.repeat(64)}
      )`, 'pilot_manual_contacts_contact_lead_fk');
    await expectConstraint(sql`
      INSERT INTO pilot_manual_contacts (
        pilot_run_id, lead_id, contact_id, channel, approved_template_version_id,
        operator_principal_id, idempotency_key, payload_fingerprint
      ) VALUES (
        ${fixture.runId}::uuid, ${fixture.otherLeadId}::uuid, ${fixture.otherContactId}::uuid,
        'EMAIL_MANUAL', 'template-v1', 'migration-test', 'outside-pilot', ${'3'.repeat(64)}
      )`, 'pilot_manual_contacts_pilot_run_id_lead_id_fkey');

    await sql`
      INSERT INTO pilot_timeline_events (pilot_run_id, lead_id, event_type, principal_id, new_value)
      VALUES (${fixture.runId}::uuid, ${fixture.associatedLeadId}::uuid, 'LEAD_EVENT', 'migration-test', '{}'::jsonb)`;
    await expectConstraint(sql`
      INSERT INTO pilot_timeline_events (pilot_run_id, lead_id, event_type, principal_id, new_value)
      VALUES (${fixture.runId}::uuid, ${fixture.otherLeadId}::uuid, 'CROSS_EVENT', 'migration-test', '{}'::jsonb)
    `, 'pilot_timeline_events_pilot_lead_fk');

    const resultForeignKey = await sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pilot_results'::regclass
          AND contype = 'f'
          AND confrelid = 'pilot_leads'::regclass
      ) AS present`;
    assert.equal(resultForeignKey[0]?.present, true, 'pilot_results must retain its sufficient composite FK');
  });

  await withDatabase('invalid_contact', async (sql) => {
    await applyBefore0012(sql);
    const fixture = await createFixture(sql);
    await sql`
      INSERT INTO pilot_manual_contacts (
        pilot_run_id, lead_id, contact_id, channel, approved_template_version_id,
        operator_principal_id, idempotency_key, payload_fingerprint
      ) VALUES (
        ${fixture.runId}::uuid, ${fixture.associatedLeadId}::uuid, ${fixture.otherContactId}::uuid,
        'EMAIL_MANUAL', 'template-v1', 'migration-test', 'legacy-cross-contact', ${'4'.repeat(64)}
      )`;
    await expectConstraint(apply0012(sql), 'pilot_manual_contacts_contact_lead_audit');
    const state = await sql<{ index_present: boolean; contact_fk_present: boolean; timeline_fk_present: boolean }[]>`
      SELECT
        to_regclass('lead_contacts_id_lead_id_uidx') IS NOT NULL AS index_present,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilot_manual_contacts_contact_lead_fk') AS contact_fk_present,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilot_timeline_events_pilot_lead_fk') AS timeline_fk_present`;
    assert.deepEqual(state[0], { index_present: false, contact_fk_present: false, timeline_fk_present: false });
  });

  await withDatabase('invalid_timeline', async (sql) => {
    await applyBefore0012(sql);
    const fixture = await createFixture(sql);
    await sql`
      INSERT INTO pilot_timeline_events (pilot_run_id, lead_id, event_type, principal_id, new_value)
      VALUES (${fixture.runId}::uuid, ${fixture.otherLeadId}::uuid, 'LEGACY_CROSS_EVENT', 'migration-test', '{}'::jsonb)`;
    await expectConstraint(apply0012(sql), 'pilot_timeline_events_pilot_lead_audit');
    const state = await sql<{ index_present: boolean; contact_fk_present: boolean; timeline_fk_present: boolean }[]>`
      SELECT
        to_regclass('lead_contacts_id_lead_id_uidx') IS NOT NULL AS index_present,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilot_manual_contacts_contact_lead_fk') AS contact_fk_present,
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilot_timeline_events_pilot_lead_fk') AS timeline_fk_present`;
    assert.deepEqual(state[0], { index_present: false, contact_fk_present: false, timeline_fk_present: false });
  });

  console.log('Migration 0012 evidence: idempotent upgrade, fail-closed audits, atomic rollback, and declarative integrity passed');
} finally {
  await admin.end();
}
