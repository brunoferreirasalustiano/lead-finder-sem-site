import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = postgres(databaseUrl, { max: 1 });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const suffix = randomUUID();
let transactionOpen = false;
let integrationPassed = false;
let currentStage = 'INITIALIZE';

function markStage(stage: string) {
  currentStage = stage;
  console.log(JSON.stringify({
    diagnostic: 'EMAIL_DELIVERY_SUPPRESSION_INTEGRATION',
    stage,
  }));
}

function sanitizedErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

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
  markStage('BEGIN_TRANSACTION');
  await sql`begin`;
  transactionOpen = true;

  markStage('HARD_BOUNCE_FIXTURE');
  const hardBounceLeadId = randomUUID();
  const hardBounceContactId = randomUUID();
  const hardBounceFingerprint = digest(`hard-bounce:${suffix}`);
  const hardBounceOccurredAt = new Date('2026-08-05T18:00:00.000Z');

  await sql`
    insert into leads(
      id,osm_type,osm_id,name,category,score,status,is_closed
    ) values(
      ${hardBounceLeadId}::uuid,'node',${`suppression-hard-${suffix}`},
      'Empresa sintética hard bounce','beleza',90,'SEM_SITE_CADASTRADO',false
    )`;
  await sql`
    insert into lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid,possible_whatsapp
    ) values(
      ${hardBounceContactId}::uuid,${hardBounceLeadId}::uuid,'EMAIL',
      ${`bounce-${suffix}@example.test`},${`bounce-${suffix}@example.test`},
      'PUBLIC_BUSINESS_SOURCE',1,now(),true,false
    )`;

  markStage('HARD_BOUNCE_INSERT');
  const firstHardBounce = (await sql<{
    suppression_id: string;
    replayed: boolean;
    contact_invalidated: boolean;
    lead_email_suppressed: boolean;
  }[]>`
    select * from public.record_email_delivery_suppression(
      ${hardBounceContactId}::uuid,
      ${hardBounceLeadId}::uuid,
      'HARD_BOUNCE',
      'GMAIL_DSN',
      ${hardBounceFingerprint}::char(64),
      ${hardBounceOccurredAt}::timestamptz
    )`)[0]!;

  markStage('CONTACT_INVALIDATION');
  assert.equal(firstHardBounce.replayed, false);
  assert.equal(firstHardBounce.contact_invalidated, true);
  assert.equal(firstHardBounce.lead_email_suppressed, false);
  assert.equal(
    (await sql<{ valid: boolean }[]>`
      select is_valid valid from lead_contacts
      where id=${hardBounceContactId}::uuid`)[0]?.valid,
    false,
  );

  markStage('IDEMPOTENT_REPLAY');
  const replayedHardBounce = (await sql<{
    suppression_id: string;
    replayed: boolean;
    contact_invalidated: boolean;
  }[]>`
    select * from public.record_email_delivery_suppression(
      ${hardBounceContactId}::uuid,
      ${hardBounceLeadId}::uuid,
      'HARD_BOUNCE',
      'GMAIL_DSN',
      ${hardBounceFingerprint}::char(64),
      ${hardBounceOccurredAt}::timestamptz
    )`)[0]!;
  assert.equal(replayedHardBounce.replayed, true);
  assert.equal(replayedHardBounce.suppression_id, firstHardBounce.suppression_id);
  assert.equal(
    (await sql<{ count: number }[]>`
      select count(*)::int count from contact_delivery_suppressions
      where event_fingerprint=${hardBounceFingerprint}::char(64)`)[0]?.count,
    1,
  );

  markStage('DIVERGENT_REPLAY_REJECTION');
  await expectRejectedInSavepoint('suppression_conflict', () => sql`
    select * from public.record_email_delivery_suppression(
      ${hardBounceContactId}::uuid,
      ${hardBounceLeadId}::uuid,
      'INVALID_CONTACT',
      'GMAIL_DSN',
      ${hardBounceFingerprint}::char(64),
      ${hardBounceOccurredAt}::timestamptz
    )`);

  markStage('OPT_OUT_FIXTURE');
  const optOutLeadId = randomUUID();
  const optOutContactId = randomUUID();
  const optOutFingerprint = digest(`opt-out:${suffix}`);
  const optOutOccurredAt = new Date('2026-08-05T18:05:00.000Z');

  await sql`
    insert into leads(
      id,osm_type,osm_id,name,category,score,status,is_closed
    ) values(
      ${optOutLeadId}::uuid,'node',${`suppression-optout-${suffix}`},
      'Empresa sintética opt out','beleza',90,'SEM_SITE_CADASTRADO',false
    )`;
  await sql`
    insert into lead_contacts(
      id,lead_id,type,original_value,normalized_value,source,confidence,
      verified_at,is_valid,possible_whatsapp
    ) values(
      ${optOutContactId}::uuid,${optOutLeadId}::uuid,'EMAIL',
      ${`optout-${suffix}@example.test`},${`optout-${suffix}@example.test`},
      'PUBLIC_BUSINESS_SOURCE',1,now(),true,false
    )`;

  markStage('OPT_OUT_INSERT');
  const optOut = (await sql<{
    replayed: boolean;
    contact_invalidated: boolean;
    lead_email_suppressed: boolean;
  }[]>`
    select * from public.record_email_delivery_suppression(
      ${optOutContactId}::uuid,
      ${optOutLeadId}::uuid,
      'OPT_OUT',
      'OPERATOR_CONFIRMED',
      ${optOutFingerprint}::char(64),
      ${optOutOccurredAt}::timestamptz
    )`)[0]!;

  markStage('OPT_OUT_ASSERTIONS');
  assert.equal(optOut.replayed, false);
  assert.equal(optOut.contact_invalidated, false);
  assert.equal(optOut.lead_email_suppressed, true);
  assert.equal(
    (await sql<{ valid: boolean }[]>`
      select is_valid valid from lead_contacts
      where id=${optOutContactId}::uuid`)[0]?.valid,
    true,
  );
  assert.equal(
    (await sql<{ count: number }[]>`
      select count(*)::int count from campaign_opt_outs
      where lead_id=${optOutLeadId}::uuid and channel='EMAIL'`)[0]?.count,
    1,
  );

  markStage('APPEND_ONLY_UPDATE_REJECTION');
  await expectRejectedInSavepoint('suppression_update', () => sql`
    update contact_delivery_suppressions
    set source='ALTERED'
    where event_fingerprint=${optOutFingerprint}::char(64)`);

  markStage('APPEND_ONLY_DELETE_REJECTION');
  await expectRejectedInSavepoint('suppression_delete', () => sql`
    delete from contact_delivery_suppressions
    where event_fingerprint=${optOutFingerprint}::char(64)`);

  integrationPassed = true;
  console.log(JSON.stringify({
    result: 'EMAIL_DELIVERY_SUPPRESSION_INTEGRATION_PASS',
    hardBounceInvalidated: true,
    optOutSuppressed: true,
    idempotency: 'PASS',
    appendOnly: 'PASS',
  }));
} catch (error) {
  console.error(JSON.stringify({
    result: 'EMAIL_DELIVERY_SUPPRESSION_INTEGRATION_FAIL',
    stage: currentStage,
    errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    errorCode: sanitizedErrorCode(error),
  }));
  throw error;
} finally {
  if (transactionOpen) {
    if (integrationPassed) markStage('TRANSACTION_ROLLBACK');
    await sql`rollback`.catch(() => undefined);
  }
  await sql.end();
}
