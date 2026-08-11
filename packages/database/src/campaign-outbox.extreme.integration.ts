import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  confirmSimulatedCampaignExecution,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
} from './campaign-outbox.js';
import { createDatabase } from './index.js';
import { campaignOutbox } from './schema.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for extreme campaign outbox integration tests');
const { db, close } = createDatabase(databaseUrl);
const workerB = createDatabase(databaseUrl);
const policy: CampaignExecutionPolicy = {
  dailyLimitEmail: 100, dailyLimitWhatsapp: 100, minSpacingMs: 0, maxAttempts: 3,
  retryBaseMs: 1_000, retryMaxMs: 4_000, windowStartUtc: '00:00', windowEndUtc: '23:59',
};
let sequence = 0;

const at = (offset: number) => new Date(Date.UTC(2001, 0, 1, 0, 0, 0, offset));

const insertItem = async (availableAt: Date, id = crypto.randomUUID()) => {
  sequence += 1;
  return (await db.insert(campaignOutbox).values({
    id, aggregateType: 'extreme-integration', aggregateId: crypto.randomUUID(), eventType: 'SIMULATED',
    payload: { fixture: sequence }, idempotencyKey: `extreme-${sequence}-${crypto.randomUUID()}`,
    payloadFingerprint: 'e'.repeat(64), availableAt,
  }).returning())[0]!;
};

const insertExecutable = async (now: Date) => {
  sequence += 1;
  const suffix = `extreme-${sequence}-${crypto.randomUUID()}`;
  const contactValue = `fixture-${suffix}@example.test`;
  const rows = await db.execute<{ outbox_id: string }>(sql`
    WITH lead AS (
      INSERT INTO leads (osm_type, osm_id, category, score, status, qualification_status, website_status, crm_stage)
      VALUES ('node', ${suffix}, 'integration', 1, 'SEM_SITE_CADASTRADO', 'SEM_SITE_CONFIRMADO', 'NO_OFFICIAL_SITE_CONFIRMED', 'QUALIFICADO') RETURNING id
    ), contact AS (
      INSERT INTO lead_contacts (lead_id, type, original_value, normalized_value, source, confidence, verified_at, is_valid, possible_whatsapp)
      SELECT id, 'EMAIL', ${contactValue}, ${contactValue}, 'integration', 1, ${now.toISOString()}::timestamptz, true, false FROM lead
    ), campaign AS (
      INSERT INTO campaigns (name, idempotency_key, payload_fingerprint, state)
      VALUES (${suffix}, ${`campaign-${suffix}`}, ${'e'.repeat(64)}, 'ATIVA') RETURNING id
    ), version AS (
      INSERT INTO campaign_versions (campaign_id, version_number, state) SELECT id, 1, 'APROVADA' FROM campaign RETURNING id, campaign_id
    ), recipient AS (
      INSERT INTO campaign_recipients (campaign_id, campaign_version_id, lead_id, channel, state, recipient_snapshot, idempotency_key, payload_fingerprint, available_at)
      SELECT version.campaign_id, version.id, lead.id, 'EMAIL', 'PENDENTE', '{}'::jsonb, ${`recipient-${suffix}`}, ${'e'.repeat(64)}, ${now.toISOString()}::timestamptz FROM version CROSS JOIN lead RETURNING id
    ), attempt AS (
      INSERT INTO campaign_attempts (recipient_id, state, payload_snapshot, idempotency_key, payload_fingerprint, available_at)
      SELECT id, 'APROVADA', '{}'::jsonb, ${`attempt-${suffix}`}, ${'e'.repeat(64)}, ${now.toISOString()}::timestamptz FROM recipient RETURNING id
    )
    INSERT INTO campaign_outbox (aggregate_type, aggregate_id, event_type, payload, idempotency_key, payload_fingerprint, available_at)
    SELECT 'attempt', id, 'ATTEMPT_CREATED', '{}'::jsonb, ${`outbox-${suffix}`}, ${'e'.repeat(64)}, ${now.toISOString()}::timestamptz FROM attempt RETURNING id AS outbox_id
  `);
  return rows[0]!.outbox_id;
};

const claim = (database: typeof db, workerId: string, now: Date, leaseMs = 1_000) =>
  claimCampaignOutbox(database, { workerId, leaseMs, maxAttempts: policy.maxAttempts, now });

const status = async (id: string) => (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, id)))[0]!;
const starts = async (id: string) => (await db.execute<{ value: number }>(sql`
  SELECT count(*)::int AS value FROM campaign_execution_starts WHERE outbox_id = ${id}::uuid
`))[0]!.value;
const deadLetters = async (id: string) => (await db.execute<{ value: number }>(sql`
  SELECT count(*)::int AS value FROM campaign_dead_letters WHERE outbox_id = ${id}::uuid
`))[0]!.value;

try {
  // Repeat actual concurrent claims, not timings, to catch races without sleeps or weakened assertions.
  for (let run = 0; run < 20; run += 1) {
    const now = at(run * 10_000);
    const item = await insertItem(now);
    const claims = await Promise.all([claim(db, `contender-a-${run}`, now), claim(workerB.db, `contender-b-${run}`, now)]);
    const winner = claims.filter((candidate) => candidate?.id === item.id);
    assert.equal(winner.length, 1, `run ${run}: exactly one worker claims a contested item`);
    assert.equal(claims.filter(Boolean).length, 1, `run ${run}: no second lease exists for the same item`);
    assert.equal(await completeCampaignOutbox(db, winner[0]!, now), true);
  }

  const restartAt = at(300_000);
  const restartItem = await insertItem(restartAt);
  const beforeRestart = await claim(db, 'claimed-then-restarted', restartAt);
  assert.equal(beforeRestart?.id, restartItem.id);
  assert.equal(await claim(workerB.db, 'immediate-restart', restartAt), null, 'restart immediately after claim must preserve the lease');
  const recoveredAfterRestart = await claim(workerB.db, 'restart-after-lease', at(301_000));
  assert.equal(recoveredAfterRestart?.id, restartItem.id);
  assert.equal(await completeCampaignOutbox(db, beforeRestart, at(301_000)), false, 'pre-restart worker cannot ACK after lease expiry');
  assert.equal(await completeCampaignOutbox(workerB.db, recoveredAfterRestart, at(301_000)), true);

  const processingAt = at(310_000);
  const executableId = await insertExecutable(processingAt);
  const firstExecutionClaim = await claim(db, 'processing-worker', processingAt);
  assert.equal(firstExecutionClaim?.id, executableId);
  const firstAuthorization = await authorizeCampaignExecution(db, firstExecutionClaim, policy, processingAt);
  assert.equal(firstAuthorization.decision, 'STARTED');
  const resumedClaim = await claim(workerB.db, 'processing-restart', at(311_000));
  assert.equal(resumedClaim?.id, executableId, 'a restart during processing reclaims only after expiry');
  const resumedAuthorization = await authorizeCampaignExecution(workerB.db, resumedClaim, policy, at(311_000));
  assert.equal(resumedAuthorization.decision, 'STARTED');
  if (firstAuthorization.decision === 'STARTED' && resumedAuthorization.decision === 'STARTED') {
    assert.equal(resumedAuthorization.executionId, firstAuthorization.executionId, 'restart must reuse the logical execution identity');
    assert.deepEqual(await confirmSimulatedCampaignExecution(workerB.db, {
      executionId: resumedAuthorization.executionId, outboxId: executableId, cycle: resumedClaim.deadLetterCycle,
      attemptId: resumedAuthorization.attemptId, channel: resumedAuthorization.channel, workerId: resumedClaim.workerId,
      token: resumedClaim.token, generation: resumedClaim.generation, confirmedAt: at(311_000),
    }), { outcome: 'CONFIRMED', executionId: resumedAuthorization.executionId, replayed: false });
  }
  assert.equal(await completeCampaignOutbox(workerB.db, resumedClaim, at(311_000)), true);
  assert.equal(await starts(executableId), 1, 'processing restarts must never create duplicate executions');

  const finalizationAt = at(320_000);
  const finalizationItem = await insertItem(finalizationAt);
  const finalizationClaim = await claim(db, 'before-finalization', finalizationAt);
  assert.equal(finalizationClaim?.id, finalizationItem.id);
  assert.equal(await completeCampaignOutbox(db, finalizationClaim, at(320_999)), true, 'completion just before expiry wins deterministically');
  assert.equal(await claim(workerB.db, 'restart-after-finalization', at(321_000)), null);
  assert.equal((await status(finalizationItem.id)).status, 'PUBLISHED');

  const expiryAt = at(330_000);
  const expiryItem = await insertItem(expiryAt);
  const expiredClaim = await claim(db, 'lease-expiring', expiryAt);
  assert.equal(expiredClaim?.id, expiryItem.id);
  const replacementClaim = await claim(workerB.db, 'lease-reclaimer', at(331_000));
  assert.equal(replacementClaim?.id, expiryItem.id, 'lease is reclaimable at its exact expiration instant');
  assert.equal(await failCampaignOutbox(db, expiredClaim, policy, at(331_000)), 'STALE', 'expired worker cannot schedule a duplicate retry');
  assert.equal(await completeCampaignOutbox(workerB.db, replacementClaim, at(331_000)), true);

  const retryAt = at(340_000);
  const retryItem = await insertItem(retryAt);
  const retryClaim = await claim(db, 'retry-at-expiry', retryAt);
  assert.equal(retryClaim?.id, retryItem.id);
  assert.equal(await failCampaignOutbox(db, retryClaim, policy, retryAt), 'RETRY');
  const retryExact = await claim(workerB.db, 'retry-restart', at(341_000));
  assert.equal(retryExact?.id, retryItem.id, 'retry availability and the former lease boundary are deterministic');
  assert.equal(await completeCampaignOutbox(workerB.db, retryExact, at(341_000)), true);

  const deadLetterAt = at(350_000);
  const deadLetterItem = await insertItem(deadLetterAt);
  let failureClaim = await claim(db, 'dead-letter-1', deadLetterAt);
  assert.equal(await failCampaignOutbox(db, failureClaim!, policy, deadLetterAt), 'RETRY');
  failureClaim = await claim(workerB.db, 'dead-letter-2', at(351_000));
  assert.equal(await failCampaignOutbox(workerB.db, failureClaim!, policy, at(351_000)), 'RETRY');
  failureClaim = await claim(db, 'dead-letter-3', at(353_000));
  assert.equal(await failCampaignOutbox(db, failureClaim!, policy, at(353_000)), 'DEAD_LETTERED');
  assert.equal((await status(deadLetterItem.id)).status, 'EXHAUSTED');
  assert.equal(await deadLetters(deadLetterItem.id), 1, 'the terminal attempt creates exactly one dead letter');
  assert.equal(await claim(workerB.db, 'dead-letter-must-not-return', at(400_000)), null, 'dead-lettered items never re-enter the normal queue');

  const tieAt = at(410_000);
  const [firstId, secondId, thirdId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort();
  await Promise.all([insertItem(tieAt, thirdId), insertItem(tieAt, firstId), insertItem(tieAt, secondId)]);
  const ordered = [await claim(db, 'tie-1', tieAt), await claim(workerB.db, 'tie-2', tieAt), await claim(db, 'tie-3', tieAt)];
  assert.deepEqual(ordered.map((candidate) => candidate?.id), [firstId, secondId, thirdId], 'temporal ties are ordered by id');
  for (const candidate of ordered) assert.equal(await completeCampaignOutbox(db, candidate!, tieAt), true);

  console.log('Campaign outbox extreme integration evidence: concurrency=20/20, restart=stable, leases=boundary-safe, retries=deterministic, dead-letter=terminal, executions=deduplicated');
} finally {
  await workerB.close();
  await close();
}
