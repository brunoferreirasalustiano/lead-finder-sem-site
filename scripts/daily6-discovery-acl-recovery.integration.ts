import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

// Destructive synthetic fixture setup is restricted to an explicitly local DB.
const url = new URL(process.env['DATABASE_URL'] ?? '');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
const identity = `2099-09-04|16|acl-test-${process.pid}|daily6-v1`;
const role = 'lead_finder_discovery_runtime';
const apply = async (source: string) => {
  const connection = await sql.reserve();
  try { await connection.unsafe(source); } finally { connection.release(); }
};
try {
  await apply(await readFile('database/security/create_lead_finder_discovery_runtime_hml.sql', 'utf8'));
  // Reproduce the deployed missing privileges, then apply the migration twice.
  await sql.unsafe(`REVOKE UPDATE(city,state) ON public.leads FROM ${role};
    REVOKE EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text) FROM ${role}`);
  const privileges = async () => (await sql`
    select has_column_privilege(${role},'public.leads','city','UPDATE') as city,
      has_function_privilege(${role},'lead_finder_internal.sync_daily6_batch_from_collection(text)','EXECUTE') as sync`)[0];
  assert.deepEqual(await privileges(), { city: false, sync: false });
  const migration = await readFile('database/migrations/0071_daily6_discovery_runtime_acl_recovery.sql', 'utf8');
  await apply(migration);
  await apply(migration);
  assert.deepEqual(await privileges(), { city: true, sync: true });
  await sql.begin(async tx => {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    await tx`insert into public.leads(osm_type,osm_id,name,category,score,status)
      values ('node',${identity},'synthetic','oficinas',1,'PENDENTE_VALIDACAO')`;
    await tx`update public.leads set city='Synthetic',state='SP' where osm_id=${identity}`;
    const result = await tx`select * from lead_finder_internal.sync_daily6_batch_from_collection('invalid')`;
    assert.equal(result[0]?.reason, 'INVALID_IDENTITY');
  });
  const denied = await sql`select
    has_table_privilege(${role},'public.daily6_send_ledger','SELECT') as ledger,
    has_function_privilege(${role},'lead_finder_internal.terminalize_expired_daily6_processing(text,integer)','EXECUTE') as recovery`;
  assert.deepEqual(denied[0], { ledger: false, recovery: false });
  await sql`insert into public.daily6_batches(batch_id,batch_date,slot,city_id,policy_version)
    values (${identity},'2099-09-04','16',${`acl-test-${process.pid}`},'daily6-v1')`;
  await sql`insert into public.collection_jobs(request_identity,payload,status,lease_token,lease_expires_at,attempt_count,updated_at)
    values (${identity},'{}','PROCESSING',gen_random_uuid(),now()+interval '1 hour',1,now()-interval '2 hours')`;
  const recover = () => sql`select * from lead_finder_internal.terminalize_expired_daily6_processing(${identity},3600)`;
  assert.equal((await recover())[0]?.reason, 'LEASE_NOT_EXPIRED');
  await sql`update public.collection_jobs set lease_expires_at=now()-interval '1 hour' where request_identity=${identity}`;
  await sql`update public.daily6_batches set ambiguous=1 where batch_id=${identity}`;
  assert.equal((await recover())[0]?.reason, 'SEND_SIDE_EFFECT_PRESENT');
  await sql`update public.daily6_batches set ambiguous=0 where batch_id=${identity}`;
  // Holding batch reproduces the conflicting lock order; NOWAIT must abort
  // without changing collection, rather than wait in a deadlock cycle.
  await sql.begin(async tx => {
    await tx`select batch_id from public.daily6_batches where batch_id=${identity} for update`;
    await assert.rejects(recover(), (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '55P03');
  });
  assert.equal((await sql`select status from public.collection_jobs where request_identity=${identity}`)[0]?.status, 'PROCESSING');
  assert.equal((await recover())[0]?.updated, true);
  assert.equal((await recover())[0]?.reason, 'COLLECTION_NOT_PROCESSING');
  const state = await sql`select j.status as job,b.status as batch,j.lease_token,j.attempt_count
    from public.collection_jobs j join public.daily6_batches b on b.batch_id=j.request_identity
    where j.request_identity=${identity}`;
  assert.deepEqual(state[0], { job: 'FAILED', batch: 'FAILED', lease_token: null, attempt_count: 1 });
  console.log('DISCOVERY_ACL_RECOVERY=PASS; MIGRATION_APPLIED_TWICE=true; LOCK_CONTENTION_ROLLBACK=PASS');
} finally {
  await sql`delete from public.collection_jobs where request_identity=${identity}`;
  await sql`delete from public.daily6_batches where batch_id=${identity}`;
  await sql`delete from public.leads where osm_id=${identity}`;
  await sql.end();
}
