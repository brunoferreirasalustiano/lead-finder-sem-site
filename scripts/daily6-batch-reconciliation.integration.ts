import assert from 'node:assert/strict';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sql = postgres(databaseUrl, { max: 8 });
const prefix = `2099-12-${String((process.pid % 20) + 1).padStart(2, '0')}|`;
const identities = [
  `${prefix}09|daily6-reconcile-failed-${process.pid}|daily6-v1`,
  `${prefix}13|daily6-reconcile-active-${process.pid}|daily6-v1`,
  `${prefix}16|daily6-reconcile-ledger-${process.pid}|daily6-v1`,
  `${prefix}09|daily6-reconcile-ambiguous-${process.pid}|daily6-v1`,
  `${prefix}13|daily6-reconcile-completed-${process.pid}|daily6-v1`,
  `${prefix}16|daily6-reconcile-concurrent-${process.pid}|daily6-v1`,
];

const createBatchAndJob = async (
  identity: string,
  jobStatus: string,
  options: { error?: string; lease?: 'active' | 'expired' } = {},
) => {
  await sql.begin(async (tx) => {
    const [, slot, cityId] = identity.split('|');
    await tx`
      insert into public.daily6_batches(batch_id,batch_date,slot,city_id,policy_version)
      values (${identity}, ${identity.slice(0, 10)}::date, ${slot}, ${cityId}, 'daily6-v1')`;
    await tx`
      insert into public.collection_jobs(
        request_identity,payload,status,error,attempt_count,lease_token,lease_expires_at
      ) values (
        ${identity}, ${tx.json({ collectionEgress: { enabled: true, configurationVersion: 1 } })}::jsonb,
        ${jobStatus}, ${options.error ?? null}, 1,
        ${options.lease ? '00000000-0000-4000-8000-000000000001' : null}::uuid,
        ${options.lease === 'active'
          ? new Date(Date.now() + 60_000)
          : options.lease === 'expired' ? new Date(Date.now() - 60_000) : null}
      )`;
  });
};

try {
  await createBatchAndJob(identities[0], 'FAILED', { error: 'WORKFLOW_TIMEOUT' });
  const first = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[0]})`;
  assert.deepEqual(first[0], { updated: true, reason: 'COLLECTION_FAILED' });
  const state = await sql<{ status: string; terminal_reason: string | null; sent: number; attempt_count: number; ledger: number }[]>`
    select b.status,b.terminal_reason,b.sent,j.attempt_count,
      (select count(*)::int from public.daily6_send_ledger l where l.batch_id=b.batch_id) as ledger
    from public.daily6_batches b
    join public.collection_jobs j on j.request_identity=b.batch_id
    where b.batch_id=${identities[0]}`;
  assert.deepEqual(state[0], {
    status: 'FAILED',
    terminal_reason: 'COLLECTION_FAILED:WORKFLOW_TIMEOUT',
    sent: 0,
    attempt_count: 1,
    ledger: 0,
  });
  const replay = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[0]})`;
  assert.deepEqual(replay[0], { updated: false, reason: 'ALREADY_TERMINAL' });
  await assert.rejects(
    sql`select lead_finder_internal.ensure_daily6_batch(${identities[0]}, ${identities[0].slice(0, 10)}::date, '09', 'daily6-reconcile-failed-${process.pid}', 'daily6-v1')`,
    (error: unknown) => (error as { code?: string }).code === '55000',
  );
  await sql`delete from public.collection_jobs where request_identity=${identities[0]}`;
  await assert.rejects(
    sql`
      insert into public.collection_jobs(request_identity,payload)
      values (${identities[0]}, ${sql.json({ collectionEgress: { enabled: true, configurationVersion: 1 } })}::jsonb)
    `,
    (error: unknown) => (error as { code?: string }).code === '55000',
  );

  await createBatchAndJob(identities[1], 'PROCESSING', { lease: 'active' });
  const active = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[1]})`;
  assert.deepEqual(active[0], { updated: false, reason: 'ACTIVE_IN_PROGRESS' });

  await createBatchAndJob(identities[2], 'FAILED', { error: 'WORKFLOW_TIMEOUT' });
  const [lead] = await sql<{ id: string }[]>`
    insert into public.leads(osm_type,osm_id,name,category,score,status)
    values ('node', ${`reconcile-${process.pid}`}, 'synthetic', 'oficinas', 1, 'PENDENTE_VALIDACAO')
    returning id`;
  await sql`
    insert into public.daily6_send_ledger(batch_id,send_identity,lead_id,recipient_fingerprint,status)
    values (${identities[2]}, ${identities[2] + '|send'}, ${lead.id}, ${'a'.repeat(64)}, 'RESERVED')`;
  const ledger = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[2]})`;
  assert.deepEqual(ledger[0], { updated: false, reason: 'SEND_SIDE_EFFECT_PRESENT' });

  await createBatchAndJob(identities[3], 'FAILED', { error: 'WORKFLOW_TIMEOUT' });
  await sql`update public.daily6_batches set ambiguous=1 where batch_id=${identities[3]}`;
  const ambiguous = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[3]})`;
  assert.deepEqual(ambiguous[0], { updated: false, reason: 'AMBIGUOUS_DO_NOT_TOUCH' });

  await createBatchAndJob(identities[4], 'COMPLETED');
  const completed = await sql<{ updated: boolean; reason: string }[]>`
    select * from lead_finder_internal.sync_daily6_batch_from_collection(${identities[4]})`;
  assert.deepEqual(completed[0], { updated: false, reason: 'COLLECTION_COMPLETED' });

  await createBatchAndJob(identities[5], 'FAILED', { error: 'WORKFLOW_TIMEOUT' });
  const concurrent = await Promise.all([
    sql<{ updated: boolean; reason: string }[]>`
      select * from lead_finder_internal.reconcile_orphaned_daily6_batch(${identities[5]})`,
    sql<{ updated: boolean; reason: string }[]>`
      select * from lead_finder_internal.reconcile_orphaned_daily6_batch(${identities[5]})`,
  ]);
  assert.equal(concurrent.filter((rows) => rows[0]?.updated === true).length, 1);
  assert.equal(concurrent.filter((rows) => rows[0]?.reason === 'ALREADY_TERMINAL').length, 1);
  const concurrentState = await sql<{ status: string }[]>`
    select status from public.daily6_batches where batch_id=${identities[5]}`;
  assert.equal(concurrentState[0]?.status, 'FAILED');

  console.log(JSON.stringify({
    result: 'DAILY6_BATCH_TERMINAL_RECONCILIATION_PASS',
    failedCollectionPreserved: true,
    workflowTimeoutPreserved: true,
    attemptCountPreserved: true,
    sendEffectsFailClosed: true,
    activeLeaseFailClosed: true,
    ambiguousFailClosed: true,
    completedCollectionUntouched: true,
    concurrentIdempotency: true,
    terminalReuseBlocked: true,
  }));
} finally {
  for (const identity of identities) {
    await sql`delete from public.daily6_send_ledger where batch_id=${identity}`;
    await sql`delete from public.collection_jobs where request_identity=${identity}`;
    await sql`delete from public.daily6_batches where batch_id=${identity}`;
  }
  await sql`delete from public.leads where osm_id=${`reconcile-${process.pid}`}`;
  await sql.end();
}
