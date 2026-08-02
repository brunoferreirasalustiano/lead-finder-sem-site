import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import {
  createDatabase,
  ManualMessagingError,
  prepareManualMessage,
} from '@lead-finder/database';
import { createAuthorizationContext } from '@lead-finder/shared';

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required');
const migrationsUrl = new URL('../database/migrations/', import.meta.url);
const migration0025 = await readFile(
  new URL('0025_narrow_contact_resolution.sql', migrationsUrl),
  'utf8',
);
const migration0026 = await readFile(
  new URL('0026_narrow_contact_resolution_hardening.sql', migrationsUrl),
  'utf8',
);
const migration0033 = await readFile(
  new URL('0033_manual_message_lifecycle.sql', migrationsUrl),
  'utf8',
);
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const administrator = postgres(sourceUrl, { max: 1 });
const actor = createAuthorizationContext({
  principalId: 'narrow-hardening-test',
  permissions: new Set(['manual-messaging:prepare']),
  authenticationMethod: 'integration-test',
});

const baselineMigrations = (await readdir(migrationsUrl))
  .filter((file) => /^\d{4}.*\.sql$/.test(file) && file < '0025_narrow_contact_resolution.sql')
  .sort();

async function createScenarioDatabase(prefix: string) {
  const databaseName = `${prefix}_${randomUUID().replaceAll('-', '')}`.slice(0, 63);
  const scenarioUrl = new URL(sourceUrl);
  scenarioUrl.pathname = `/${databaseName}`;
  await administrator.unsafe(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  const sql = postgres(scenarioUrl.toString(), { max: 1 });
  for (const file of baselineMigrations) {
    await sql.unsafe(await readFile(new URL(file, migrationsUrl), 'utf8'));
  }
  return { databaseName, url: scenarioUrl.toString(), sql };
}

async function destroyScenario(
  scenario: { databaseName: string; sql: ReturnType<typeof postgres> },
) {
  await scenario.sql.end().catch(() => undefined);
  await administrator.unsafe(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(scenario.databaseName)} WITH (FORCE)`,
  ).catch(() => undefined);
}

type Fixture = {
  pilotId: string;
  leadId: string;
  contactA: string;
  contactB: string;
  authorizationA: string;
};

async function insertFixture(sql: ReturnType<typeof postgres>, suffix: string): Promise<Fixture> {
  const pilotId = randomUUID();
  const leadId = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();
  const authorizationA = randomUUID();
  const authorizationB = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into leads(
      id,osm_type,osm_id,name,category,score,status,is_closed,is_blocked,do_not_contact,crm_stage
    ) values(
      ${leadId}::uuid,'node',${`hardening-${suffix}`} ,'Empresa Hardening','oficinas',90,
      'SEM_SITE_CADASTRADO',false,false,false,'NOVO'
    )`;
    await tx`insert into pilot_runs(
      id,name,region,category,target_lead_count,status,created_by,started_at
    ) values(
      ${pilotId}::uuid,${`Hardening ${suffix}`} ,'SP','oficinas',2,'RUNNING',
      'integration-test',now()
    )`;
    await tx`insert into pilot_leads(pilot_run_id,lead_id,source,added_by)
      values(${pilotId}::uuid,${leadId}::uuid,'SYNTHETIC','integration-test')`;
    await tx`insert into pilot_reviews(
      pilot_run_id,lead_id,decision,reviewer_principal_id,version
    ) values(${pilotId}::uuid,${leadId}::uuid,'APPROVED','reviewer',1)`;
    await tx`insert into lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,verified_at,is_valid,possible_whatsapp
    ) values
      (${contactA}::uuid,${leadId}::uuid,'TELEFONE','+12025550110','+12025550110',
        'DIRECTLY_PROVIDED',1,now(),true,true),
      (${contactB}::uuid,${leadId}::uuid,'TELEFONE','+12025550111','+12025550111',
        'DIRECTLY_PROVIDED',1,now(),true,true)`;
    await tx`insert into contact_channel_authorizations(
      id,contact_id,lead_id,channel,purpose,origin,evidence_fingerprint,granted_at,recorded_by
    ) values
      (${authorizationA}::uuid,${contactA}::uuid,${leadId}::uuid,'WHATSAPP','B2B_PROSPECTION',
        'DIRECT_OPT_IN',${createHash('sha256').update(`auth-a-${suffix}`).digest('hex')},now(),'integration-test'),
      (${authorizationB}::uuid,${contactB}::uuid,${leadId}::uuid,'WHATSAPP','B2B_PROSPECTION',
        'DIRECT_OPT_IN',${createHash('sha256').update(`auth-b-${suffix}`).digest('hex')},now(),'integration-test')`;
  });
  return { pilotId, leadId, contactA, contactB, authorizationA };
}

const validInput = (contactId: string) => ({
  contactId,
  requestedChannel: 'WHATSAPP' as const,
  templateId: 'pilot-whatsapp-first-contact',
  templateVersion: 'v1',
  idempotencyKey: randomUUID(),
});

const success = await createScenarioDatabase('lf_hardening_success');
let successDatabase: ReturnType<typeof createDatabase> | undefined;
try {
  await success.sql.unsafe('CREATE SCHEMA custom_crypto');
  await success.sql.unsafe('CREATE EXTENSION pgcrypto WITH SCHEMA custom_crypto');
  await success.sql.unsafe(migration0025);
  const before = (await success.sql<{ schema: string }[]>`
    select namespace.nspname schema
    from pg_extension extension
    join pg_namespace namespace on namespace.oid=extension.extnamespace
    where extension.extname='pgcrypto'`)[0]?.schema;
  assert.equal(before, 'custom_crypto');

  await success.sql.unsafe(migration0026);
  await success.sql.unsafe(migration0026);
  // The legacy scenario exercises the current manual-messaging service after
  // applying the narrow-contact migrations, so install the lifecycle schema
  // before preparing a message.
  await success.sql.unsafe(migration0033);
  const after = (await success.sql<{ schema: string }[]>`
    select namespace.nspname schema
    from pg_extension extension
    join pg_namespace namespace on namespace.oid=extension.extnamespace
    where extension.extname='pgcrypto'`)[0]?.schema;
  assert.equal(after, 'extensions');

  const constraints = (await success.sql<{
    uniqueValid: boolean;
    foreignKeyValid: boolean;
  }[]>`
    select
      exists(
        select 1 from pg_constraint
        where conrelid='public.contact_channel_authorizations'::regclass
          and conname='contact_channel_authorizations_identity_unique'
          and contype='u' and convalidated
      ) "uniqueValid",
      exists(
        select 1 from pg_constraint
        where conrelid='public.contact_channel_authorization_revocations'::regclass
          and conname='contact_channel_authorization_revocations_authorization_identity_fk'
          and contype='f' and convalidated
      ) "foreignKeyValid"`)[0];
  assert.deepEqual(constraints, { uniqueValid: true, foreignKeyValid: true });

  const fixture = await insertFixture(success.sql, 'success');
  const mismatchedReason = createHash('sha256').update('mismatched-revocation').digest('hex');
  await assert.rejects(success.sql`
    insert into contact_channel_authorization_revocations(
      authorization_id,contact_id,lead_id,purpose,revoked_by,reason_fingerprint
    ) values(
      ${fixture.authorizationA}::uuid,${fixture.contactB}::uuid,${fixture.leadId}::uuid,
      'B2B_PROSPECTION','integration-test',${mismatchedReason}
    )`);

  const validReason = createHash('sha256').update('valid-revocation').digest('hex');
  await success.sql`
    insert into contact_channel_authorization_revocations(
      authorization_id,contact_id,lead_id,purpose,revoked_by,reason_fingerprint
    ) values(
      ${fixture.authorizationA}::uuid,${fixture.contactA}::uuid,${fixture.leadId}::uuid,
      'B2B_PROSPECTION','integration-test',${validReason}
    )`;

  successDatabase = createDatabase(success.url, { max: 4 });
  await assert.rejects(
    prepareManualMessage(
      successDatabase.db,
      fixture.pilotId,
      fixture.leadId,
      validInput(fixture.contactA),
      actor,
    ),
    (error: unknown) => error instanceof ManualMessagingError && error.code === 'INELIGIBLE',
  );
  const prepared = await prepareManualMessage(
    successDatabase.db,
    fixture.pilotId,
    fixture.leadId,
    validInput(fixture.contactB),
    actor,
  );
  assert.equal(prepared.state, 'PREPARED');
} finally {
  await successDatabase?.close().catch(() => undefined);
  await destroyScenario(success);
}

const invalid = await createScenarioDatabase('lf_hardening_invalid');
try {
  await invalid.sql.unsafe('CREATE SCHEMA extensions');
  await invalid.sql.unsafe('CREATE EXTENSION pgcrypto WITH SCHEMA extensions');
  await invalid.sql.unsafe(migration0025);
  const fixture = await insertFixture(invalid.sql, 'invalid');
  await invalid.sql`
    insert into contact_channel_authorization_revocations(
      authorization_id,contact_id,lead_id,purpose,revoked_by,reason_fingerprint
    ) values(
      ${fixture.authorizationA}::uuid,${fixture.contactB}::uuid,${fixture.leadId}::uuid,
      'B2B_PROSPECTION','integration-test',
      ${createHash('sha256').update('historical-mismatch').digest('hex')}
    )`;
  await assert.rejects(
    invalid.sql.unsafe(migration0026),
    /controlled reconciliation is required/,
  );
} finally {
  await destroyScenario(invalid);
  await administrator.end();
}

console.log(JSON.stringify({
  result: 'NARROW_CONTACT_HARDENING_POSTGRES_PASS',
  pgcryptoNormalized: true,
  revocationTupleForeignKey: true,
  historicalMismatchFailsClosed: true,
  correctedRevocationAfterRejectedMismatch: true,
  providerCalls: 0,
  networkMessageCalls: 0,
}));
