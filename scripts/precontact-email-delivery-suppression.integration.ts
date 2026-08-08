import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = postgres(databaseUrl, { max: 1 });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const suffix = randomUUID();
let transactionOpen = false;

async function expectRejectedInSavepoint(
  name: string,
  action: () => Promise<unknown>,
) {
  await sql.unsafe(`SAVEPOINT ${name}`);
  try {
    await assert.rejects(action());
  } finally {
    await sql.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await sql.unsafe(`RELEASE SAVEPOINT ${name}`);
  }
}

try {
  await sql`begin`;
  transactionOpen = true;

  const syntheticEmail = `precontact-${suffix}@example.test`;
  const eventFingerprint = digest(`precontact-hard-bounce:${suffix}`);
  const occurredAt = new Date('2026-08-07T12:00:00.000Z');

  const firstSuppression = (await sql<{
    suppression_id: string;
    replayed: boolean;
    invalidated_contacts: number;
  }[]>`
    select * from public.record_precontact_email_delivery_suppression(
      ${syntheticEmail},
      'HARD_BOUNCE',
      'GMAIL_DSN_RECONCILIATION',
      ${eventFingerprint}::char(64),
      ${occurredAt}::timestamptz
    )`)[0]!;

  assert.equal(firstSuppression.replayed, false);
  assert.equal(firstSuppression.invalidated_contacts, 0);

  const ledgerRow = (await sql<{
    identity_fingerprint: string;
    reason: string;
    source: string;
  }[]>`
    select identity_fingerprint,reason,source
    from public.email_precontact_delivery_suppressions
    where event_fingerprint=${eventFingerprint}::char(64)`)[0]!;

  assert.match(ledgerRow.identity_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(ledgerRow.reason, 'HARD_BOUNCE');
  assert.equal(ledgerRow.source, 'GMAIL_DSN_RECONCILIATION');
  assert.notEqual(ledgerRow.identity_fingerprint, digest(syntheticEmail));

  const ledgerColumns = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema='public'
      and table_name='email_precontact_delivery_suppressions'`;
  assert.equal(
    ledgerColumns.some(({ column_name }) =>
      ['email','email_address','normalized_value','original_value','contact_value']
        .includes(column_name)),
    false,
  );

  const privateKey = (await sql<{ bytes: number }[]>`
    select octet_length(secret)::int bytes
    from lead_finder_private.email_suppression_hmac_key
    where singleton=true`)[0];
  assert.equal(privateKey?.bytes, 32);

  const firstLeadId = randomUUID();
  const firstContactId = randomUUID();
  await sql`
    insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed)
    values(
      ${firstLeadId}::uuid,'node',${`precontact-first-${suffix}`},
      'Empresa sintética precontact 1','beleza',90,'SEM_SITE_CADASTRADO',false
    )`;
  await sql`
    insert into lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid,possible_whatsapp
    ) values(
      ${firstContactId}::uuid,${firstLeadId}::uuid,'EMAIL',
      ${syntheticEmail},${syntheticEmail},'PUBLIC_BUSINESS_SOURCE',1,
      now(),true,false
    )`;

  const firstContact = (await sql<{
    is_valid: boolean;
    identity_fingerprint: string;
  }[]>`
    select is_valid,
      email_precontact_identity_fingerprint identity_fingerprint
    from lead_contacts where id=${firstContactId}::uuid`)[0]!;
  assert.equal(firstContact.is_valid, false);
  assert.equal(firstContact.identity_fingerprint, ledgerRow.identity_fingerprint);

  const secondLeadId = randomUUID();
  const secondContactId = randomUUID();
  await sql`
    insert into leads(id,osm_type,osm_id,name,category,score,status,is_closed)
    values(
      ${secondLeadId}::uuid,'node',${`precontact-second-${suffix}`},
      'Empresa sintética precontact 2','beleza',90,'SEM_SITE_CADASTRADO',false
    )`;
  await sql`
    insert into lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid,possible_whatsapp
    ) values(
      ${secondContactId}::uuid,${secondLeadId}::uuid,'EMAIL',
      ${syntheticEmail},${syntheticEmail},'PUBLIC_BUSINESS_SOURCE',1,
      now(),true,false
    )`;

  const secondContact = (await sql<{
    is_valid: boolean;
    identity_fingerprint: string;
  }[]>`
    select is_valid,
      email_precontact_identity_fingerprint identity_fingerprint
    from lead_contacts where id=${secondContactId}::uuid`)[0]!;
  assert.equal(secondContact.is_valid, false);
  assert.equal(secondContact.identity_fingerprint, ledgerRow.identity_fingerprint);

  const replay = (await sql<{
    suppression_id: string;
    replayed: boolean;
    invalidated_contacts: number;
  }[]>`
    select * from public.record_precontact_email_delivery_suppression(
      ${syntheticEmail},
      'HARD_BOUNCE',
      'GMAIL_DSN_RECONCILIATION',
      ${eventFingerprint}::char(64),
      ${occurredAt}::timestamptz
    )`)[0]!;
  assert.equal(replay.replayed, true);
  assert.equal(replay.suppression_id, firstSuppression.suppression_id);
  assert.equal(replay.invalidated_contacts, 0);

  assert.equal(
    (await sql<{ count: number }[]>`
      select count(*)::int count
      from public.email_precontact_delivery_suppressions
      where event_fingerprint=${eventFingerprint}::char(64)`)[0]?.count,
    1,
  );

  await expectRejectedInSavepoint('precontact_event_conflict', () => sql`
    select * from public.record_precontact_email_delivery_suppression(
      ${syntheticEmail},
      'INVALID_CONTACT',
      'GMAIL_DSN_RECONCILIATION',
      ${eventFingerprint}::char(64),
      ${occurredAt}::timestamptz
    )`);

  await expectRejectedInSavepoint('precontact_temporary_failure', () => sql`
    select * from public.record_precontact_email_delivery_suppression(
      ${`temporary-${suffix}@example.test`},
      'TEMPORARY_FAILURE',
      'GMAIL_DSN_RECONCILIATION',
      ${digest(`temporary:${suffix}`)}::char(64),
      ${occurredAt}::timestamptz
    )`);

  await expectRejectedInSavepoint('precontact_update', () => sql`
    update public.email_precontact_delivery_suppressions
    set source='ALTERED'
    where event_fingerprint=${eventFingerprint}::char(64)`);

  await expectRejectedInSavepoint('precontact_delete', () => sql`
    delete from public.email_precontact_delivery_suppressions
    where event_fingerprint=${eventFingerprint}::char(64)`);

  const runtimeRoleExists = (await sql<{ exists: boolean }[]>`
    select exists(
      select 1 from pg_roles where rolname='lead_finder_api_runtime'
    ) exists`)[0]?.exists;
  if (runtimeRoleExists) {
    const runtimeAcl = (await sql<{
      table_access: boolean;
      private_schema_access: boolean;
      record_execute: boolean;
    }[]>`
      select
        has_table_privilege(
          'lead_finder_api_runtime',
          'public.email_precontact_delivery_suppressions',
          'SELECT,INSERT,UPDATE,DELETE'
        ) table_access,
        has_schema_privilege(
          'lead_finder_api_runtime',
          'lead_finder_private',
          'USAGE'
        ) private_schema_access,
        has_function_privilege(
          'lead_finder_api_runtime',
          'public.record_precontact_email_delivery_suppression(text,text,text,character,timestamptz)',
          'EXECUTE'
        ) record_execute`)[0]!;
    assert.equal(runtimeAcl.table_access, false);
    assert.equal(runtimeAcl.private_schema_access, false);
    assert.equal(runtimeAcl.record_execute, false);
  }

  const serviceRoleExists = (await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname='service_role') exists`)[0]?.exists;
  if (serviceRoleExists) {
    const serviceAcl = (await sql<{
      table_access: boolean;
      private_schema_access: boolean;
      record_execute: boolean;
    }[]>`
      select
        has_table_privilege(
          'service_role',
          'public.email_precontact_delivery_suppressions',
          'SELECT,INSERT,UPDATE,DELETE'
        ) table_access,
        has_schema_privilege('service_role','lead_finder_private','USAGE') private_schema_access,
        has_function_privilege(
          'service_role',
          'public.record_precontact_email_delivery_suppression(text,text,text,character,timestamptz)',
          'EXECUTE'
        ) record_execute`)[0]!;
    assert.equal(serviceAcl.table_access, false);
    assert.equal(serviceAcl.private_schema_access, false);
    assert.equal(serviceAcl.record_execute, true);
  }

  console.log(JSON.stringify({
    result: 'PRECONTACT_EMAIL_DELIVERY_SUPPRESSION_INTEGRATION_PASS',
    rawEmailPersisted: false,
    deterministicHmacIdentity: 'PASS',
    precontactBlock: 'PASS',
    crossLeadRediscovery: 'PASS',
    idempotency: 'PASS',
    temporaryFailureRejected: 'PASS',
    appendOnly: 'PASS',
    runtimeDirectAccess: 'DENIED',
  }));
} finally {
  if (transactionOpen) await sql`rollback`.catch(() => undefined);
  await sql.end();
}
