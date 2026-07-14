import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
} from './campaign-outbox.js';
import { createDatabase } from './index.js';
import { campaignOutbox } from './schema.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for campaign outbox integration tests');
const { db, close } = createDatabase(databaseUrl);
const second = createDatabase(databaseUrl);
const base = new Date('2000-01-01T00:00:00.000Z');
let sequence = 0;
const insertItem = async (availableAt = base, id?: string) => {
  sequence += 1;
  return (await db.insert(campaignOutbox).values({
    id, aggregateType: 'integration', aggregateId: crypto.randomUUID(), eventType: 'SIMULATED',
    payload: { fixture: sequence }, idempotencyKey: `outbox-integration-${sequence}-${crypto.randomUUID()}`,
    payloadFingerprint: 'a'.repeat(64), availableAt,
  }).returning())[0]!;
};
const claim = (workerId: string, now = base, token = crypto.randomUUID()) =>
  claimCampaignOutbox(db, { workerId, leaseMs: 10_000, maxAttempts: 5, now, token });
const policy: CampaignExecutionPolicy = {
  dailyLimitEmail: 1, dailyLimitWhatsapp: 1, minSpacingMs: 0, maxAttempts: 3,
  retryBaseMs: 1_000, retryMaxMs: 4_000, windowStartUtc: '08:00', windowEndUtc: '18:00',
};

const insertExecutableAttempt = async (channel: 'EMAIL' | 'WHATSAPP', now: Date) => {
  sequence += 1;
  const suffix = `${sequence}-${crypto.randomUUID()}`;
  const rows = await db.execute<{ outbox_id: string }>(sql`
    WITH inserted_lead AS (
      INSERT INTO leads (osm_type, osm_id, category, score, status, qualification_status, crm_stage)
      VALUES ('node', ${suffix}, 'integration', 1, 'SEM_SITE_CADASTRADO', 'SEM_SITE_CONFIRMADO', 'QUALIFICADO')
      RETURNING id
    ), inserted_contact AS (
      INSERT INTO lead_contacts (lead_id, type, original_value, normalized_value, source, confidence, verified_at, is_valid, possible_whatsapp)
      SELECT id, ${channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP'}, 'fixture', ${suffix}, 'integration', 1, ${now.toISOString()}::timestamptz, true, ${channel === 'WHATSAPP'}
      FROM inserted_lead
    ), inserted_campaign AS (
      INSERT INTO campaigns (name, idempotency_key, payload_fingerprint, state)
      VALUES ('integration', ${`campaign-${suffix}`}, ${'a'.repeat(64)}, 'ATIVA') RETURNING id
    ), inserted_version AS (
      INSERT INTO campaign_versions (campaign_id, version_number, state)
      SELECT id, 1, 'APROVADA' FROM inserted_campaign RETURNING id, campaign_id
    ), inserted_recipient AS (
      INSERT INTO campaign_recipients
        (campaign_id, campaign_version_id, lead_id, channel, state, recipient_snapshot, idempotency_key, payload_fingerprint, available_at)
      SELECT v.campaign_id, v.id, l.id, ${channel}, 'ELEGIVEL', '{}'::jsonb, ${`recipient-${suffix}`}, ${'b'.repeat(64)}, ${now.toISOString()}::timestamptz
      FROM inserted_version v CROSS JOIN inserted_lead l RETURNING id
    ), inserted_attempt AS (
      INSERT INTO campaign_attempts
        (recipient_id, state, payload_snapshot, idempotency_key, payload_fingerprint, available_at)
      SELECT id, 'APROVADA', '{}'::jsonb, ${`attempt-${suffix}`}, ${'c'.repeat(64)}, ${now.toISOString()}::timestamptz
      FROM inserted_recipient RETURNING id
    )
    INSERT INTO campaign_outbox
      (aggregate_type, aggregate_id, event_type, payload, idempotency_key, payload_fingerprint, available_at)
    SELECT 'attempt', id, 'ATTEMPT_CREATED', '{}'::jsonb, ${`outbox-${suffix}`}, ${'d'.repeat(64)}, ${now.toISOString()}::timestamptz
    FROM inserted_attempt RETURNING id AS outbox_id
  `);
  return rows[0]!.outbox_id;
};

try {
  const contested = await insertItem();
  const contenders = await Promise.all([claim('worker-a'), claim('worker-b')]);
  const winners = contenders.filter((item) => item?.id === contested.id);
  assert.equal(winners.length, 1, 'exactly one worker must win a contested claim');
  assert.equal(contenders.filter(Boolean).length, 1, 'a row cannot have two valid claims');
  assert.equal(await completeCampaignOutbox(db, winners[0]!, base), true);

  const parallelItems = await Promise.all([insertItem(), insertItem()]);
  const parallelClaims = await Promise.all([claim('worker-a'), claim('worker-b')]);
  assert.equal(new Set(parallelClaims.map((item) => item?.id)).size, 2, 'workers must claim different items concurrently');
  assert.deepEqual(new Set(parallelClaims.map((item) => item?.id)), new Set(parallelItems.map((item) => item.id)));
  for (const parallelClaim of parallelClaims) assert.equal(await completeCampaignOutbox(db, parallelClaim!, base), true);

  const future = await insertItem(new Date(base.getTime() + 1));
  assert.equal(await claim('future-worker'), null, 'future items must not be consumed early');
  const futureClaim = await claim('future-worker', new Date(base.getTime() + 1));
  assert.equal(futureClaim?.id, future.id);
  assert.equal(await claim('lease-thief', new Date(base.getTime() + 2)), null, 'an active lease cannot be stolen');

  const recoveredAt = new Date(base.getTime() + 10_002);
  const recovered = await claim('restart-worker', recoveredAt);
  assert.equal(recovered?.id, future.id, 'an expired lease must be recoverable after restart');
  assert.equal(recovered?.generation, (futureClaim?.generation ?? 0) + 1);
  assert.equal(await completeCampaignOutbox(db, futureClaim, recoveredAt), false, 'an old generation cannot ACK');
  assert.equal(await completeCampaignOutbox(db, { ...recovered, token: crypto.randomUUID() }, recoveredAt), false, 'an old token cannot ACK');
  assert.equal(await completeCampaignOutbox(db, recovered, recoveredAt), true, 'the current valid claim can ACK');
  assert.equal((await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, future.id)))[0]?.status, 'PUBLISHED');

  const [firstId, secondId, laterId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort();
  await insertItem(new Date(base.getTime() + 20_000), laterId);
  await insertItem(new Date(base.getTime() + 19_000), secondId);
  await insertItem(new Date(base.getTime() + 19_000), firstId);
  const orderedAt = new Date(base.getTime() + 20_000);
  const ordered = [
    await claim('ordered-1', orderedAt),
    await claim('ordered-2', orderedAt),
    await claim('ordered-3', orderedAt),
  ];
  assert.deepEqual(ordered.map((item) => item?.id), [firstId, secondId, laterId], 'claims must order by availability and id');
  for (const orderedClaim of ordered) assert.equal(await completeCampaignOutbox(db, orderedClaim!, orderedAt), true);

  const executionAt = new Date('2026-07-14T12:00:00.000Z');
  const contestedExecutionIds = await Promise.all([
    insertExecutableAttempt('EMAIL', executionAt), insertExecutableAttempt('EMAIL', executionAt),
  ]);
  const executionClaims = await Promise.all([
    claimCampaignOutbox(db, { workerId: 'quota-a', leaseMs: 10_000, maxAttempts: 3, now: executionAt }),
    claimCampaignOutbox(second.db, { workerId: 'quota-b', leaseMs: 10_000, maxAttempts: 3, now: executionAt }),
  ]);
  assert.deepEqual(new Set(executionClaims.map((item) => item?.id)), new Set(contestedExecutionIds));
  const quotaDecisions = await Promise.all([
    authorizeCampaignExecution(db, executionClaims[0]!, policy, executionAt),
    authorizeCampaignExecution(second.db, executionClaims[1]!, policy, executionAt),
  ]);
  assert.equal(quotaDecisions.filter((item) => item.decision === 'STARTED').length, 1, 'only one worker wins the final daily slot');
  assert.equal(quotaDecisions.filter((item) => item.decision === 'RESCHEDULED').length, 1, 'daily loser is deterministically rescheduled');
  await db.execute(sql`UPDATE campaign_outbox SET status = 'PUBLISHED', published_at = ${executionAt.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE id IN (${contestedExecutionIds[0]}::uuid, ${contestedExecutionIds[1]}::uuid)`);

  const outsideAt = new Date('2026-07-15T18:00:00.000Z');
  const outsideId = await insertExecutableAttempt('WHATSAPP', outsideAt);
  const outsideClaim = await claimCampaignOutbox(db, { workerId: 'window', leaseMs: 10_000, maxAttempts: 3, now: outsideAt });
  assert.equal(outsideClaim?.id, outsideId);
  const outsideDecision = await authorizeCampaignExecution(db, outsideClaim, policy, outsideAt);
  assert.equal(outsideDecision.decision, 'RESCHEDULED', 'the exact window end is excluded');
  if (outsideDecision.decision === 'RESCHEDULED') assert.equal(outsideDecision.availableAt.toISOString(), '2026-07-16T08:00:00.000Z');

  const retryItem = await insertItem(new Date('2026-07-17T12:00:00.000Z'));
  const retryClaim = await claimCampaignOutbox(db, { workerId: 'retry', leaseMs: 10_000, maxAttempts: 3, now: new Date('2026-07-17T12:00:00.000Z') });
  assert.equal(retryClaim?.id, retryItem.id);
  assert.equal(await failCampaignOutbox(db, retryClaim, policy, new Date('2026-07-17T12:00:00.000Z')), 'RETRY');
  assert.equal(await failCampaignOutbox(second.db, retryClaim, policy, new Date('2026-07-17T12:00:00.000Z')), 'STALE');
  const retryRow = (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id)))[0]!;
  assert.equal(retryRow.availableAt.toISOString(), '2026-07-17T12:00:01.000Z');

  console.log('Campaign outbox integration evidence: contested=1, parallel=2, future=blocked, activeLease=protected, expiredLease=recovered, staleAck=rejected, restart=preserved, ordering=deterministic');
} finally {
  await second.close();
  await close();
}
