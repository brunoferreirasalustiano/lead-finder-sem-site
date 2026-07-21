import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { buildApp } from '../apps/api/src/app.js';
import { createDryRunItemProcessor, processLeadBatch } from '@lead-finder/batch-processor';
import { abandonBatchInvocation, beginBatchInvocation, completeBatchInvocation,
  createDatabase, type Database } from '@lead-finder/database';

const ORIGIN = 'SYNTHETIC_AUTOMATED_BATCH_GATE';
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('BATCH_GATE_DATABASE_URL_REQUIRED');
const { db, close } = createDatabase(databaseUrl, { ssl: 'disable' });
const suffix = randomUUID().replaceAll('-', '');
const successKey = `batch_gate_success_${suffix}`;
const failureKey = `batch_gate_failure_${suffix}`;
const secret = `batch_gate_secret_${suffix}`;
const executorId = `batch-gate-${suffix}`;
const requestHeaders = (key: string) => ({ authorization: `Bearer ${secret}`,
  'x-cron-audience': 'lead-finder-batch', 'idempotency-key': key });
type Fixture = { lead_id: string; contact_id: string; campaign_id: string; version_id: string;
  recipient_id: string; attempt_id: string; outbox_id: string };

async function createFixture(database: Database): Promise<Fixture> {
  const rows = await database.execute<Fixture>(sql`
    WITH lead AS (
      INSERT INTO leads (osm_type, osm_id, name, category, email, score, status, normalized_name,
        normalized_address, is_closed, is_blocked, do_not_contact)
      VALUES ('node', ${`gate-${suffix}`}, ${ORIGIN}, 'synthetic', ${`gate-${suffix}@example.invalid`},
        100, 'SEM_SITE_CONFIRMADO', ${ORIGIN}, ${`synthetic-${suffix}`}, false, false, false) RETURNING id
    ), contact AS (
      INSERT INTO lead_contacts (lead_id, type, original_value, normalized_value, source, confidence,
        verified_at, is_valid, possible_whatsapp)
      SELECT id, 'EMAIL', ${`gate-${suffix}@example.invalid`}, ${`gate-${suffix}@example.invalid`},
        ${ORIGIN}, 1, transaction_timestamp(), true, false FROM lead RETURNING id, lead_id
    ), campaign AS (
      INSERT INTO campaigns (name, idempotency_key, payload_fingerprint, state)
      VALUES (${ORIGIN}, ${`campaign-${suffix}`}, ${`fingerprint-${suffix}`}, 'ATIVA') RETURNING id
    ), version AS (
      INSERT INTO campaign_versions (campaign_id, version_number, state)
      SELECT id, 1, 'APROVADA' FROM campaign RETURNING id, campaign_id
    ), recipient AS (
      INSERT INTO campaign_recipients (campaign_id, campaign_version_id, lead_id, channel, state,
        recipient_snapshot, idempotency_key, payload_fingerprint, available_at)
      SELECT c.id, v.id, l.id, 'EMAIL', 'ELEGIVEL',
        jsonb_build_object('synthetic', true, 'origin', ${ORIGIN}), ${`recipient-${suffix}`},
        ${`fingerprint-${suffix}`}, transaction_timestamp() - interval '1 second'
      FROM campaign c CROSS JOIN version v CROSS JOIN lead l RETURNING id
    ), attempt AS (
      INSERT INTO campaign_attempts (recipient_id, state, payload_snapshot, idempotency_key,
        payload_fingerprint, available_at)
      SELECT id, 'APROVADA', jsonb_build_object('synthetic', true, 'origin', ${ORIGIN}),
        ${`attempt-${suffix}`}, ${`fingerprint-${suffix}`}, transaction_timestamp() - interval '1 second'
      FROM recipient RETURNING id
    ), outbox AS (
      INSERT INTO campaign_outbox (aggregate_type, aggregate_id, event_type, payload, idempotency_key,
        payload_fingerprint, status, attempts, available_at)
      SELECT 'attempt', id, 'ATTEMPT_CREATED', jsonb_build_object('synthetic', true, 'origin', ${ORIGIN}),
        ${`outbox-${suffix}`}, ${`fingerprint-${suffix}`}, 'PENDING', 0,
        transaction_timestamp() - interval '1 second' FROM attempt RETURNING id
    )
    SELECT l.id lead_id, ct.id contact_id, c.id campaign_id, v.id version_id,
      r.id recipient_id, a.id attempt_id, o.id outbox_id
    FROM lead l CROSS JOIN contact ct CROSS JOIN campaign c CROSS JOIN version v
      CROSS JOIN recipient r CROSS JOIN attempt a CROSS JOIN outbox o`);
  assert.equal(rows.length, 1);
  return rows[0]!;
}

async function snapshot(database: Database, fixture: Fixture, key: string) {
  const rows = await database.execute<{
    total: number; pending: number; published: number; claimable: number; attempts: number;
    claims_cleared: boolean; json_objects: boolean; starts: number; confirmations: number;
    allocations: number; counter: number; monotonic: boolean; invocations: number; completed: number;
    providers: number; duplicates: number;
  }>(sql`SELECT
    count(*)::int total,
    count(*) FILTER (WHERE status = 'PENDING')::int pending,
    count(*) FILTER (WHERE status = 'PUBLISHED')::int published,
    count(*) FILTER (WHERE status = 'PENDING' AND available_at <= transaction_timestamp()
      AND (claim_expires_at IS NULL OR claim_expires_at <= transaction_timestamp()))::int claimable,
    max(attempts)::int attempts,
    bool_and(claim_worker_id IS NULL AND claim_token IS NULL AND claimed_at IS NULL
      AND claim_expires_at IS NULL) claims_cleared,
    (SELECT jsonb_typeof(recipient_snapshot) = 'object' FROM campaign_recipients WHERE id = ${fixture.recipient_id}::uuid)
      AND (SELECT jsonb_typeof(payload_snapshot) = 'object' FROM campaign_attempts WHERE id = ${fixture.attempt_id}::uuid)
      AND bool_and(jsonb_typeof(payload) = 'object') json_objects,
    (SELECT count(*)::int FROM campaign_execution_starts WHERE outbox_id = ${fixture.outbox_id}::uuid) starts,
    (SELECT count(*)::int FROM campaign_simulated_confirmations WHERE outbox_id = ${fixture.outbox_id}::uuid) confirmations,
    (SELECT count(*)::int FROM deployment_daily_lead_allocations WHERE outbox_id = ${fixture.outbox_id}::uuid) allocations,
    (SELECT COALESCE(sum(c.count), 0)::int FROM deployment_daily_lead_counters c JOIN deployment_daily_lead_allocations a
      ON a.quota_day = c.quota_day WHERE a.outbox_id = ${fixture.outbox_id}::uuid) counter,
    COALESCE((SELECT bool_and(c.updated_at >= c.created_at) FROM deployment_daily_lead_counters c
      JOIN deployment_daily_lead_allocations a ON a.quota_day = c.quota_day
      WHERE a.outbox_id = ${fixture.outbox_id}::uuid), true) monotonic,
    (SELECT count(*)::int FROM batch_invocations WHERE idempotency_key = ${key}) invocations,
    (SELECT count(*)::int FROM batch_invocations WHERE idempotency_key = ${key} AND completed_at IS NOT NULL) completed,
    (SELECT count(*)::int FROM campaign_provider_events WHERE attempt_id = ${fixture.attempt_id}::uuid) providers,
    (SELECT count(*)::int FROM (
      SELECT outbox_id, cycle FROM campaign_execution_starts WHERE outbox_id = ${fixture.outbox_id}::uuid GROUP BY 1,2 HAVING count(*) > 1
      UNION ALL SELECT outbox_id, cycle FROM campaign_simulated_confirmations WHERE outbox_id = ${fixture.outbox_id}::uuid GROUP BY 1,2 HAVING count(*) > 1
      UNION ALL SELECT outbox_id, dead_letter_cycle FROM deployment_daily_lead_allocations WHERE outbox_id = ${fixture.outbox_id}::uuid GROUP BY 1,2 HAVING count(*) > 1
    ) d) duplicates
    FROM campaign_outbox WHERE id = ${fixture.outbox_id}::uuid`);
  return rows[0]!;
}

const invocationOptions = {
  authentication: { token: secret, principalPermissions: ['leads:read'] as const },
  internalCronSecret: secret, cronAuthAudience: 'lead-finder-batch',
  beginBatchInvocation: (key: string) => beginBatchInvocation(db, key, 'supabase-render'),
  completeBatchInvocation: (key: string) => completeBatchInvocation(db, key),
  abandonBatchInvocation: (key: string) => abandonBatchInvocation(db, key),
};

async function run(): Promise<void> {
  const fixture = await createFixture(db);
  const before = await snapshot(db, fixture, successKey);
  assert.deepEqual({ total: before.total, pending: before.pending, claimable: before.claimable,
    attempts: before.attempts, starts: before.starts, confirmations: before.confirmations,
    allocations: before.allocations, providers: before.providers, invocations: before.invocations,
    jsonObjects: before.json_objects }, { total: 1, pending: 1, claimable: 1, attempts: 0,
    starts: 0, confirmations: 0, allocations: 0, providers: 0, invocations: 0, jsonObjects: true });

  const policy = { dailyLimitEmail: 60, dailyLimitWhatsapp: 60, windowStartUtc: '00:00',
    windowEndUtc: '23:59', minSpacingMs: 0, maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 60_000 };
  const processOne = createDryRunItemProcessor({ db, workerId: executorId, leaseMs: 30_000,
    dailyLimit: 60, executionSource: 'supabase-render', policy });
  const app = buildApp(db, { ...invocationOptions,
    processLeadBatch: () => processLeadBatch({ db, batchSize: 5, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'supabase-render', executorId, processorRole: 'primary',
      leadershipLeaseMs: 30_000, processOne }) });
  const first = await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers: requestHeaders(successKey) });
  assert.equal(first.statusCode, 200);
  const body = first.json<{ processed: number; attempted: number; executionSource: string; outcome: string }>();
  assert.equal(body.processed, 1); assert.ok(body.attempted >= 1);
  assert.equal(body.executionSource, 'supabase-render'); assert.equal(body.outcome, 'COMPLETED');
  const replay = await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers: requestHeaders(successKey) });
  assert.equal(replay.statusCode, 409); assert.equal(replay.json<{ code: string }>().code, 'IDEMPOTENCY_REPLAY');
  await app.close();

  const after = await snapshot(db, fixture, successKey);
  assert.deepEqual({ total: after.total, published: after.published, pending: after.pending,
    claimable: after.claimable, attempts: after.attempts, claimsCleared: after.claims_cleared,
    starts: after.starts, confirmations: after.confirmations, allocations: after.allocations,
    counter: after.counter, monotonic: after.monotonic, invocations: after.invocations,
    completed: after.completed, providers: after.providers, duplicates: after.duplicates },
  { total: 1, published: 1, pending: 0, claimable: 0, attempts: 1, claimsCleared: true,
    starts: 1, confirmations: 1, allocations: 1, counter: 1, monotonic: true,
    invocations: 1, completed: 1, providers: 0, duplicates: 0 });

  let fail = true;
  const failureApp = buildApp(db, { ...invocationOptions, processLeadBatch: async () => {
    if (fail) { fail = false; throw new Error('SYNTHETIC_BATCH_GATE_FAILURE'); }
    return { executionSource: 'supabase-render', outcome: 'COMPLETED', attempted: 0, processed: 0, durationMs: 0 };
  } });
  const failed = await failureApp.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers: requestHeaders(failureKey) });
  assert.equal(failed.statusCode, 500);
  const abandoned = await db.execute<{ count: number }>(sql`SELECT count(*)::int count FROM batch_invocations WHERE idempotency_key = ${failureKey}`);
  assert.equal(abandoned[0]?.count, 0);
  const retry = await failureApp.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers: requestHeaders(failureKey) });
  assert.equal(retry.statusCode, 200);
  const retried = await db.execute<{ total: number; completed: number }>(sql`SELECT count(*)::int total,
    count(*) FILTER (WHERE completed_at IS NOT NULL)::int completed FROM batch_invocations WHERE idempotency_key = ${failureKey}`);
  assert.deepEqual(retried[0], { total: 1, completed: 1 });
  await failureApp.close();
  console.log(JSON.stringify({ gate: ORIGIN, fixtureRows: 7, firstCall: 'HTTP_200_PROCESSED_1',
    replay: 'HTTP_409_IDEMPOTENCY_REPLAY', abandonedRetry: 'HTTP_500_THEN_HTTP_200',
    providerEvents: 0, externalEffects: 0, result: 'PASS' }));
}

try { await run(); } finally { await close(); }
