import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { claimCampaignOutbox, failCampaignOutbox, type CampaignExecutionPolicy } from './campaign-outbox.js';
import { createDatabase } from './index.js';
import { reserveDailyLeadAllocation } from './deployment-processing.js';
import { campaignOutbox } from './schema.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for deployment processing integration tests');
const primary = createDatabase(databaseUrl);
const secondary = createDatabase(databaseUrl);
let sequence = 0;

const policy: CampaignExecutionPolicy = {
  dailyLimitEmail: 60, dailyLimitWhatsapp: 60, minSpacingMs: 0, maxAttempts: 3,
  retryBaseMs: 1_000, retryMaxMs: 4_000, windowStartUtc: '00:00', windowEndUtc: '23:59',
};

const insertItem = async (availableAt: Date) => {
  sequence += 1;
  return (await primary.db.insert(campaignOutbox).values({
    aggregateType: 'deployment-integration', aggregateId: crypto.randomUUID(), eventType: 'SIMULATED',
    payload: { fixture: sequence }, idempotencyKey: `deployment-integration-${sequence}-${crypto.randomUUID()}`,
    payloadFingerprint: 'e'.repeat(64), availableAt,
  }).returning())[0]!;
};

const claimAt = async (now: Date, workerId: string) => {
  const claimed = await claimCampaignOutbox(primary.db, { workerId, leaseMs: 60_000, maxAttempts: 3, now });
  assert.ok(claimed, `expected a claim for ${workerId}`);
  return claimed;
};

const deferClaim = async (id: string, nextDay: Date) => {
  await primary.db.execute(sql`UPDATE campaign_outbox SET available_at = ${nextDay.toISOString()}::timestamptz,
    attempts = greatest(attempts - 1, 0), claim_worker_id = NULL, claim_token = NULL,
    claimed_at = NULL, claim_expires_at = NULL WHERE id = ${id}::uuid`);
};

const counter = async (day: string) => (await primary.db.execute<{ count: number }>(sql`
  SELECT count FROM deployment_daily_lead_counters WHERE quota_day = ${day}::date
`))[0]?.count ?? 0;

try {
  const dayOne = new Date('2099-01-01T23:59:00.000Z');
  const dayTwo = new Date('2099-01-02T00:01:00.000Z');
  const carry = await insertItem(dayOne);
  const firstClaim = await claimAt(dayOne, 'carry-day-one');
  assert.equal(await reserveDailyLeadAllocation(primary.db, firstClaim, {
    source: 'oracle-vps', configuredLimit: 60, now: dayOne,
  }), 'RESERVED');
  assert.equal(await reserveDailyLeadAllocation(primary.db, firstClaim, {
    source: 'oracle-vps', configuredLimit: 60, now: dayOne,
  }), 'REPLAY', 'same-day replay must not consume quota twice');
  await deferClaim(carry.id, dayTwo);
  const secondClaim = await claimAt(dayTwo, 'carry-day-two');
  assert.equal(await reserveDailyLeadAllocation(primary.db, secondClaim, {
    source: 'supabase-render', configuredLimit: 60, now: dayTwo,
  }), 'RESERVED', 'unstarted carry-over must reserve quota on its effective execution day');
  assert.equal(await counter('2099-01-01'), 0, 'stale unexecuted reservation must leave its old day');
  assert.equal(await counter('2099-01-02'), 1, 'carry-over must consume current-day quota');
  await primary.db.execute(sql`UPDATE campaign_outbox SET status = 'PUBLISHED',
    published_at = ${dayTwo.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE id = ${carry.id}::uuid`);

  const fullDay = new Date('2099-01-03T12:00:00.000Z');
  await primary.db.execute(sql`INSERT INTO deployment_daily_lead_counters (quota_day, count)
    VALUES ('2099-01-03'::date, 60) ON CONFLICT (quota_day) DO UPDATE SET count = 60`);
  const deferred = await insertItem(fullDay);
  const deferredClaim = await claimAt(fullDay, 'quota-deferred-one');
  assert.equal(deferredClaim.attempt, 1);
  assert.equal(await reserveDailyLeadAllocation(primary.db, deferredClaim, {
    source: 'oracle-vps', configuredLimit: 60, now: fullDay,
  }), 'LIMIT_REACHED');
  let deferredRow = (await primary.db.select().from(campaignOutbox).where(eq(campaignOutbox.id, deferred.id)))[0]!;
  assert.equal(deferredRow.attempts, 0, 'quota-only deferral must refund the claim attempt');
  assert.equal(deferredRow.claimToken, null, 'quota-only deferral must release the lease');

  const nextFullDay = new Date('2099-01-04T12:00:00.000Z');
  await primary.db.execute(sql`INSERT INTO deployment_daily_lead_counters (quota_day, count)
    VALUES ('2099-01-04'::date, 60) ON CONFLICT (quota_day) DO UPDATE SET count = 60`);
  const restartedClaim = await claimAt(nextFullDay, 'quota-deferred-restart');
  assert.equal(restartedClaim.id, deferred.id, 'restart must reclaim the quota-deferred item');
  assert.equal(await reserveDailyLeadAllocation(primary.db, restartedClaim, {
    source: 'supabase-render', configuredLimit: 60, now: nextFullDay,
  }), 'LIMIT_REACHED');
  deferredRow = (await primary.db.select().from(campaignOutbox).where(eq(campaignOutbox.id, deferred.id)))[0]!;
  assert.equal(deferredRow.attempts, 0, 'multi-day quota deferral must not exhaust max attempts');

  const concurrencyDay = new Date('2099-01-05T12:00:00.000Z');
  const concurrentItems = await Promise.all(Array.from({ length: 61 }, () => insertItem(concurrencyDay)));
  const concurrentClaims = await Promise.all(concurrentItems.map((_, index) =>
    claimCampaignOutbox(index % 2 === 0 ? primary.db : secondary.db, {
      workerId: `quota-concurrent-${index}`, leaseMs: 60_000, maxAttempts: 3, now: concurrencyDay,
    })));
  assert.equal(concurrentClaims.filter(Boolean).length, 61);
  const reservations = await Promise.all(concurrentClaims.map((claim, index) => reserveDailyLeadAllocation(
    index % 2 === 0 ? primary.db : secondary.db, claim!, {
      source: index % 2 === 0 ? 'oracle-vps' : 'supabase-render', configuredLimit: 60, now: concurrencyDay,
    },
  )));
  assert.equal(reservations.filter((result) => result === 'RESERVED').length, 60);
  assert.equal(reservations.filter((result) => result === 'LIMIT_REACHED').length, 1);
  assert.equal(await counter('2099-01-05'), 60, 'concurrent processors must never exceed the database ceiling');
  await primary.db.execute(sql`UPDATE campaign_outbox SET status = 'PUBLISHED',
    published_at = ${concurrencyDay.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE aggregate_type = 'deployment-integration' AND status = 'PENDING'`);

  const failureDay = new Date('2099-01-06T12:00:00.000Z');
  const failing = await insertItem(failureDay);
  const failureClaim = await claimAt(failureDay, 'real-failure-after-quota');
  assert.equal(await reserveDailyLeadAllocation(primary.db, failureClaim, {
    source: 'oracle-vps', configuredLimit: 60, now: failureDay,
  }), 'RESERVED');
  assert.equal(await failCampaignOutbox(primary.db, failureClaim, policy, failureDay), 'RETRY');
  assert.equal((await primary.db.select().from(campaignOutbox).where(eq(campaignOutbox.id, failing.id)))[0]!.attempts, 1,
    'a real processing failure after quota reservation must retain its consumed attempt');

  console.log('Deployment processing integration evidence: effective-day=reserved, same-day-replay=idempotent, carry-over=bounded, concurrent=60, quota-deferral=attempt-refunded, restart=recoverable, real-failure=attempt-retained');
} finally {
  await secondary.close();
  await primary.close();
}
