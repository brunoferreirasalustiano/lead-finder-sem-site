import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migration = await readFile(
  new URL(
    '../database/migrations/0073_daily6_dispatch_preclaim_failure_terminalization.sql',
    import.meta.url,
  ),
  'utf8',
);
const primary = postgres(databaseUrl, { max: 1 });
const secondary = postgres(databaseUrl, { max: 1 });
const dayOffset = Number.parseInt(crypto.randomUUID().slice(0, 8), 16) % 10_000;
const testDay = new Date(Date.UTC(2050, 0, 1) + dayOffset * 86_400_000)
  .toISOString()
  .slice(0, 10);
const scheduledHour: Record<'09' | '13' | '16', string> = {
  '09': '12',
  '13': '16',
  '16': '19',
};

const identity = (slot: '09' | '13' | '16') =>
  `${testDay}|${slot}|campinas-sp|daily6-v1`;

async function insertAccepted(slot: '09' | '13' | '16') {
  const dispatchNonce = crypto.randomUUID();
  await primary`
    INSERT INTO public.daily6_scheduler_dispatches
      (request_identity, correlation_id, dispatch_nonce, scheduled_at, status, github_http_status)
    VALUES
      (${identity(slot)}, ${crypto.randomUUID()}::uuid, ${dispatchNonce}::uuid,
       ${`${testDay}T${scheduledHour[slot]}:07:00.000Z`}::timestamptz,
       'DISPATCH_ACCEPTED', 204)
  `;
  return dispatchNonce;
}

async function statusFor(dispatchNonce: string) {
  const rows = await primary<{ status: string }[]>`
    SELECT status
    FROM public.daily6_scheduler_dispatches
    WHERE dispatch_nonce = ${dispatchNonce}::uuid
  `;
  return rows[0]?.status;
}

try {
  // The migration must remain replay-safe after the complete historical chain.
  await primary.unsafe(migration);
  await primary.unsafe(migration);

  const rejectedSuccessNonce = await insertAccepted('09');
  const preclaimSuccess = await primary<{ finalized: boolean }[]>`
    SELECT lead_finder_internal.finalize_daily6_scheduler_dispatch(
      ${rejectedSuccessNonce}::uuid,
      'WORKFLOW_SUCCEEDED'
    ) AS finalized
  `;
  assert.equal(preclaimSuccess[0]?.finalized, false);
  assert.equal(await statusFor(rejectedSuccessNonce), 'DISPATCH_ACCEPTED');

  const failed = await primary<{ finalized: boolean }[]>`
    SELECT lead_finder_internal.finalize_daily6_scheduler_dispatch(
      ${rejectedSuccessNonce}::uuid,
      'WORKFLOW_FAILED'
    ) AS finalized
  `;
  assert.equal(failed[0]?.finalized, true);
  assert.equal(await statusFor(rejectedSuccessNonce), 'WORKFLOW_FAILED');

  const failedReplay = await primary<{ finalized: boolean }[]>`
    SELECT lead_finder_internal.finalize_daily6_scheduler_dispatch(
      ${rejectedSuccessNonce}::uuid,
      'WORKFLOW_FAILED'
    ) AS finalized
  `;
  assert.equal(failedReplay[0]?.finalized, false);

  const claimAfterFailure = await primary<{ claimed: boolean }[]>`
    SELECT lead_finder_internal.claim_daily6_scheduler_dispatch(
      ${identity('09')},
      ${rejectedSuccessNonce}::uuid
    ) AS claimed
  `;
  assert.equal(claimAfterFailure[0]?.claimed, false);

  const concurrentNonce = await insertAccepted('13');
  const [claimResult, finalizeResult] = await Promise.all([
    primary<{ claimed: boolean }[]>`
      SELECT lead_finder_internal.claim_daily6_scheduler_dispatch(
        ${identity('13')},
        ${concurrentNonce}::uuid
      ) AS claimed
    `,
    secondary<{ finalized: boolean }[]>`
      SELECT lead_finder_internal.finalize_daily6_scheduler_dispatch(
        ${concurrentNonce}::uuid,
        'WORKFLOW_FAILED'
      ) AS finalized
    `,
  ]);
  assert.equal(finalizeResult[0]?.finalized, true);
  assert.equal(typeof claimResult[0]?.claimed, 'boolean');
  assert.equal(await statusFor(concurrentNonce), 'WORKFLOW_FAILED');

  const publicAcl = await primary<{ public_execute: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc procedure_record
      CROSS JOIN LATERAL aclexplode(
        coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
      ) privilege
      WHERE procedure_record.oid =
        'lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid,text)'::regprocedure
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) AS public_execute
  `;
  assert.equal(publicAcl[0]?.public_execute, false);

  const runtimeRole = await primary<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'lead_finder_discovery_runtime'
    ) AS exists
  `;
  if (runtimeRole[0]?.exists) {
    const privileges = await primary<{ function_execute: boolean; table_select: boolean }[]>`
      SELECT
        has_function_privilege(
          'lead_finder_discovery_runtime',
          'lead_finder_internal.finalize_daily6_scheduler_dispatch(uuid,text)'::regprocedure,
          'EXECUTE'
        ) AS function_execute,
        has_table_privilege(
          'lead_finder_discovery_runtime',
          'public.daily6_scheduler_dispatches',
          'SELECT'
        ) AS table_select
    `;
    assert.equal(privileges[0]?.function_execute, true);
    assert.equal(privileges[0]?.table_select, false);
  }
} finally {
  await Promise.all([primary.end(), secondary.end()]);
}
