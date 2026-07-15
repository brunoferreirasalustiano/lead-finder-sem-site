import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import {
  authorizeCampaignExecution,
  claimCampaignOutbox,
  completeCampaignOutbox,
  confirmSimulatedCampaignExecution,
  failCampaignOutbox,
  recoverCampaignDeadLetter,
  type CampaignExecutionPolicy,
} from './campaign-outbox.js';
import { createDatabase, recordOptOut } from './index.js';
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
      SELECT id, ${channel === 'EMAIL' ? 'EMAIL' : 'TELEFONE'}, 'fixture', ${suffix}, 'integration', 1, ${now.toISOString()}::timestamptz, true, ${channel === 'WHATSAPP'}
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
      SELECT v.campaign_id, v.id, l.id, ${channel}, 'PENDENTE', '{}'::jsonb, ${`recipient-${suffix}`}, ${'b'.repeat(64)}, ${now.toISOString()}::timestamptz
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

const executionIdentity = async (outboxId: string) => {
  const rows = await db.execute<{
    campaign_id: string; recipient_id: string; attempt_id: string; lead_id: string; channel: 'EMAIL' | 'WHATSAPP';
  }>(sql`
    SELECT r.campaign_id, r.id AS recipient_id, a.id AS attempt_id, r.lead_id, r.channel
    FROM campaign_outbox o
    JOIN campaign_attempts a ON o.aggregate_type = 'attempt' AND a.id = o.aggregate_id
    JOIN campaign_recipients r ON r.id = a.recipient_id
    WHERE o.id = ${outboxId}::uuid
  `);
  assert.ok(rows[0], 'execution identity must exist');
  return rows[0];
};

const executionStartCount = async (outboxId: string) => {
  const rows = await db.execute<{ value: number }>(sql`
    SELECT count(*)::int AS value FROM campaign_execution_starts WHERE outbox_id = ${outboxId}::uuid
  `);
  return rows[0]?.value ?? 0;
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

  const executionAt = new Date('2000-01-02T12:00:00.000Z');
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

  const independentWhatsappId = await insertExecutableAttempt('WHATSAPP', executionAt);
  const independentWhatsappClaim = await claimCampaignOutbox(db, {
    workerId: 'quota-whatsapp', leaseMs: 10_000, maxAttempts: 3, now: executionAt,
  });
  assert.equal(independentWhatsappClaim?.id, independentWhatsappId);
  const independentWhatsappDecision = await authorizeCampaignExecution(db, independentWhatsappClaim, policy, executionAt);
  assert.equal(independentWhatsappDecision.decision, 'STARTED', 'channel quotas must be independent');
  assert.equal(await completeCampaignOutbox(db, independentWhatsappClaim, executionAt), true);

  const outsideAt = new Date('2000-01-03T18:00:00.000Z');
  const outsideId = await insertExecutableAttempt('WHATSAPP', outsideAt);
  const outsideClaim = await claimCampaignOutbox(db, { workerId: 'window', leaseMs: 10_000, maxAttempts: 3, now: outsideAt });
  assert.equal(outsideClaim?.id, outsideId);
  const outsideDecision = await authorizeCampaignExecution(db, outsideClaim, policy, outsideAt);
  assert.equal(outsideDecision.decision, 'RESCHEDULED', 'the exact window end is excluded');
  if (outsideDecision.decision === 'RESCHEDULED') {
    assert.equal(outsideDecision.availableAt.toISOString(), '2000-01-04T08:00:00.000Z');
    const windowResumedClaim = await claimCampaignOutbox(db, {
      workerId: 'window-resumed', leaseMs: 10_000, maxAttempts: 3, now: outsideDecision.availableAt,
    });
    assert.equal(windowResumedClaim?.id, outsideId);
    assert.equal((await authorizeCampaignExecution(
      db, windowResumedClaim, policy, outsideDecision.availableAt,
    )).decision, 'STARTED');
    assert.equal(await completeCampaignOutbox(db, windowResumedClaim, outsideDecision.availableAt), true);
  }

  const spacingAt = new Date('2000-01-05T12:00:00.000Z');
  const spacingPolicy = { ...policy, dailyLimitEmail: 10, minSpacingMs: 1_000 };
  const spacingIds = await Promise.all([
    insertExecutableAttempt('EMAIL', spacingAt), insertExecutableAttempt('EMAIL', spacingAt),
  ]);
  const spacingClaims = await Promise.all([
    claimCampaignOutbox(db, { workerId: 'spacing-a', leaseMs: 10_000, maxAttempts: 3, now: spacingAt }),
    claimCampaignOutbox(second.db, { workerId: 'spacing-b', leaseMs: 10_000, maxAttempts: 3, now: spacingAt }),
  ]);
  assert.deepEqual(new Set(spacingClaims.map((item) => item?.id)), new Set(spacingIds));
  const spacingDecisions = await Promise.all([
    authorizeCampaignExecution(db, spacingClaims[0]!, spacingPolicy, spacingAt),
    authorizeCampaignExecution(second.db, spacingClaims[1]!, spacingPolicy, spacingAt),
  ]);
  assert.equal(spacingDecisions.filter((item) => item.decision === 'STARTED').length, 1);
  assert.equal(spacingDecisions.filter((item) => item.decision === 'RESCHEDULED').length, 1);
  const spacingStartedIndex = spacingDecisions.findIndex((item) => item.decision === 'STARTED');
  const spacingRescheduled = spacingDecisions.find((item) => item.decision === 'RESCHEDULED');
  assert.ok(spacingStartedIndex >= 0 && spacingRescheduled?.decision === 'RESCHEDULED');
  assert.equal(spacingRescheduled.availableAt.toISOString(), '2000-01-05T12:00:01.000Z');
  assert.equal(await completeCampaignOutbox(db, spacingClaims[spacingStartedIndex]!, spacingAt), true);
  const resumedSpacingClaim = await claimCampaignOutbox(db, {
    workerId: 'spacing-resumed', leaseMs: 10_000, maxAttempts: 3, now: spacingRescheduled.availableAt,
  });
  assert.equal(resumedSpacingClaim?.id, spacingClaims[spacingStartedIndex === 0 ? 1 : 0]?.id);
  assert.equal((await authorizeCampaignExecution(db, resumedSpacingClaim!, spacingPolicy, spacingRescheduled.availableAt)).decision, 'STARTED');
  assert.equal(await completeCampaignOutbox(db, resumedSpacingClaim!, spacingRescheduled.availableAt), true);

  const racePolicy = { ...policy, dailyLimitEmail: 100, dailyLimitWhatsapp: 100, minSpacingMs: 0 };
  const pauseAt = new Date('2000-01-06T12:00:00.000Z');
  const pauseId = await insertExecutableAttempt('EMAIL', pauseAt);
  const pauseClaim = await claimCampaignOutbox(db, { workerId: 'pause-race', leaseMs: 10_000, maxAttempts: 3, now: pauseAt });
  assert.equal(pauseClaim?.id, pauseId);
  const pauseIdentity = await executionIdentity(pauseId);
  const [pauseDecision] = await Promise.all([
    authorizeCampaignExecution(db, pauseClaim, racePolicy, pauseAt),
    second.db.execute(sql`UPDATE campaigns SET state = 'PAUSADA' WHERE id = ${pauseIdentity.campaign_id}::uuid`),
  ]);
  assert.ok(pauseDecision.decision === 'STARTED'
    || (pauseDecision.decision === 'INELIGIBLE' && pauseDecision.reason === 'CAMPAIGN_NOT_ACTIVE'));
  assert.equal(await executionStartCount(pauseId), pauseDecision.decision === 'STARTED' ? 1 : 0);
  if (pauseDecision.decision === 'STARTED') assert.equal(await completeCampaignOutbox(db, pauseClaim, pauseAt), true);

  const cancelAt = new Date('2000-01-07T12:00:00.000Z');
  const cancelId = await insertExecutableAttempt('EMAIL', cancelAt);
  const cancelClaim = await claimCampaignOutbox(db, { workerId: 'cancel-race', leaseMs: 10_000, maxAttempts: 3, now: cancelAt });
  assert.equal(cancelClaim?.id, cancelId);
  const cancelIdentity = await executionIdentity(cancelId);
  const [cancelDecision] = await Promise.all([
    authorizeCampaignExecution(db, cancelClaim, racePolicy, cancelAt),
    second.db.execute(sql`UPDATE campaign_recipients SET state = 'CANCELADO'
      WHERE id = ${cancelIdentity.recipient_id}::uuid`),
  ]);
  assert.ok(cancelDecision.decision === 'STARTED'
    || (cancelDecision.decision === 'INELIGIBLE' && cancelDecision.reason === 'RECIPIENT_NOT_EXECUTABLE'));
  assert.equal(await executionStartCount(cancelId), cancelDecision.decision === 'STARTED' ? 1 : 0);
  if (cancelDecision.decision === 'STARTED') assert.equal(await completeCampaignOutbox(db, cancelClaim, cancelAt), true);

  const optOutAt = new Date('2000-01-08T12:00:00.000Z');
  const optOutId = await insertExecutableAttempt('WHATSAPP', optOutAt);
  const optOutClaim = await claimCampaignOutbox(db, { workerId: 'opt-out-race', leaseMs: 10_000, maxAttempts: 3, now: optOutAt });
  assert.equal(optOutClaim?.id, optOutId);
  const optOutIdentity = await executionIdentity(optOutId);
  const [optOutDecision] = await Promise.all([
    authorizeCampaignExecution(db, optOutClaim, racePolicy, optOutAt),
    recordOptOut(second.db, {
      leadId: optOutIdentity.lead_id, channel: 'WHATSAPP', reason: 'integration race', source: 'test',
    }),
  ]);
  assert.ok(optOutDecision.decision === 'STARTED'
    || (optOutDecision.decision === 'INELIGIBLE' && optOutDecision.reason === 'OPT_OUT'));
  assert.equal(await executionStartCount(optOutId), optOutDecision.decision === 'STARTED' ? 1 : 0);
  if (optOutDecision.decision === 'STARTED') assert.equal(await completeCampaignOutbox(db, optOutClaim, optOutAt), true);

  const postAuthorizationOptOutAt = new Date('2000-01-08T13:00:00.000Z');
  const postAuthorizationOptOutId = await insertExecutableAttempt('EMAIL', postAuthorizationOptOutAt);
  const postAuthorizationOptOutClaim = await claimCampaignOutbox(db, {
    workerId: 'post-authorization-opt-out', leaseMs: 10_000, maxAttempts: 3, now: postAuthorizationOptOutAt,
  });
  assert.equal(postAuthorizationOptOutClaim?.id, postAuthorizationOptOutId);
  if (!postAuthorizationOptOutClaim) throw new Error('post-authorization opt-out claim was not created');
  const postAuthorizationDecision = await authorizeCampaignExecution(
    db, postAuthorizationOptOutClaim, racePolicy, postAuthorizationOptOutAt,
  );
  assert.equal(postAuthorizationDecision.decision, 'STARTED');
  if (postAuthorizationDecision.decision === 'STARTED') {
    const postAuthorizationIdentity = await executionIdentity(postAuthorizationOptOutId);
    await recordOptOut(second.db, {
      leadId: postAuthorizationIdentity.lead_id, channel: 'EMAIL',
      reason: 'committed after authorization', source: 'integration-test',
    });
    await assert.rejects(() => confirmSimulatedCampaignExecution(db, {
      executionId: postAuthorizationDecision.executionId, outboxId: postAuthorizationOptOutClaim.id,
      cycle: postAuthorizationOptOutClaim.deadLetterCycle, attemptId: postAuthorizationDecision.attemptId,
      channel: postAuthorizationDecision.channel, workerId: postAuthorizationOptOutClaim.workerId,
      token: postAuthorizationOptOutClaim.token, generation: postAuthorizationOptOutClaim.generation,
      confirmedAt: postAuthorizationOptOutAt,
    }), (error: unknown) => error instanceof Error && error.message === 'SIMULATED_CONFIRMATION_INELIGIBLE');
    assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value
      FROM campaign_simulated_confirmations WHERE outbox_id = ${postAuthorizationOptOutId}::uuid`))[0]?.value, 0);
    assert.equal((await db.execute<{ status: string }>(sql`SELECT status FROM campaign_outbox
      WHERE id = ${postAuthorizationOptOutId}::uuid`))[0]?.status, 'BLOCKED');
  }

  const utcPolicy = {
    ...policy, dailyLimitWhatsapp: 1, minSpacingMs: 0, windowStartUtc: '00:00', windowEndUtc: '23:59',
  };
  const beforeUtcBoundary = new Date('2000-01-09T23:58:59.000Z');
  const beforeUtcId = await insertExecutableAttempt('WHATSAPP', beforeUtcBoundary);
  const beforeUtcClaim = await claimCampaignOutbox(db, {
    workerId: 'utc-before', leaseMs: 10_000, maxAttempts: 3, now: beforeUtcBoundary,
  });
  assert.equal(beforeUtcClaim?.id, beforeUtcId);
  assert.equal((await authorizeCampaignExecution(db, beforeUtcClaim, utcPolicy, beforeUtcBoundary)).decision, 'STARTED');
  assert.equal(await completeCampaignOutbox(db, beforeUtcClaim, beforeUtcBoundary), true);
  const afterUtcBoundary = new Date('2000-01-10T00:00:00.000Z');
  const afterUtcId = await insertExecutableAttempt('WHATSAPP', afterUtcBoundary);
  const afterUtcClaim = await claimCampaignOutbox(db, {
    workerId: 'utc-after', leaseMs: 10_000, maxAttempts: 3, now: afterUtcBoundary,
  });
  assert.equal(afterUtcClaim?.id, afterUtcId);
  assert.equal((await authorizeCampaignExecution(db, afterUtcClaim, utcPolicy, afterUtcBoundary)).decision, 'STARTED',
    'a new UTC day must receive an independent quota');
  assert.equal(await completeCampaignOutbox(db, afterUtcClaim, afterUtcBoundary), true);

  const windowRetryAt = new Date('2000-01-11T17:59:59.000Z');
  const windowRetryPolicy = {
    ...racePolicy, maxAttempts: 3, retryBaseMs: 2_000, retryMaxMs: 4_000, minSpacingMs: 1_000,
    windowStartUtc: '08:00', windowEndUtc: '18:00',
  };
  const windowRetryId = await insertExecutableAttempt('EMAIL', windowRetryAt);
  const windowRetryClaim = await claimCampaignOutbox(db, {
    workerId: 'window-retry-1', leaseMs: 10_000, maxAttempts: 3, now: windowRetryAt,
  });
  assert.equal(windowRetryClaim?.id, windowRetryId);
  assert.equal((await authorizeCampaignExecution(
    db, windowRetryClaim, windowRetryPolicy, windowRetryAt,
  )).decision, 'STARTED');
  assert.equal(await failCampaignOutbox(db, windowRetryClaim, windowRetryPolicy, windowRetryAt), 'RETRY');
  const rawWindowRetryAt = new Date('2000-01-11T18:00:01.000Z');
  const outsideWindowRetryClaim = await claimCampaignOutbox(db, {
    workerId: 'window-retry-2', leaseMs: 10_000, maxAttempts: 3, now: rawWindowRetryAt,
  });
  assert.equal(outsideWindowRetryClaim?.id, windowRetryId);
  const outsideWindowRetryDecision = await authorizeCampaignExecution(
    db, outsideWindowRetryClaim, windowRetryPolicy, rawWindowRetryAt,
  );
  assert.equal(outsideWindowRetryDecision.decision, 'RESCHEDULED');
  if (outsideWindowRetryDecision.decision === 'RESCHEDULED') {
    assert.equal(outsideWindowRetryDecision.availableAt.toISOString(), '2000-01-12T08:00:00.000Z');
    const afterWindowReschedule = (
      await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, windowRetryId))
    )[0];
    assert.equal(afterWindowReschedule?.attempts, 1, 'window rescheduling must not consume an attempt');
    const resumedWindowRetryClaim = await claimCampaignOutbox(db, {
      workerId: 'window-retry-3', leaseMs: 10_000, maxAttempts: 3,
      now: outsideWindowRetryDecision.availableAt,
    });
    assert.equal(resumedWindowRetryClaim?.id, windowRetryId);
    assert.equal(resumedWindowRetryClaim?.attempt, 2);
    assert.equal((await authorizeCampaignExecution(
      db, resumedWindowRetryClaim, windowRetryPolicy, outsideWindowRetryDecision.availableAt,
    )).decision, 'STARTED');
    const retrySpacing = await db.execute<{ matches: boolean }>(sql`SELECT
      (next_available_at = '2000-01-12T08:00:01.000Z'::timestamptz) AS matches
      FROM campaign_channel_runtime WHERE channel = 'EMAIL'`);
    assert.equal(retrySpacing[0]?.matches, true, 'a resumed retry must reserve global spacing again');
    assert.equal(await completeCampaignOutbox(
      db, resumedWindowRetryClaim, outsideWindowRetryDecision.availableAt,
    ), true);
  }
  assert.equal(await executionStartCount(windowRetryId), 1, 'a retry must not reserve quota twice');

  const retryAt = new Date('2000-01-12T12:00:00.000Z');
  const retryItem = await insertItem(retryAt);
  const retryClaim = await claimCampaignOutbox(db, {
    workerId: 'retry-1', leaseMs: 10_000, maxAttempts: 3, now: retryAt,
  });
  assert.equal(retryClaim?.id, retryItem.id);
  assert.equal(retryClaim.maxAttempts, 3);
  assert.equal(await failCampaignOutbox(db, retryClaim, policy, retryAt), 'RETRY');
  assert.equal(await failCampaignOutbox(second.db, retryClaim, policy, retryAt), 'STALE');
  const retryRow = (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id)))[0]!;
  assert.equal(retryRow.availableAt.toISOString(), '2000-01-12T12:00:01.000Z');
  const retrySecondAt = retryRow.availableAt;
  const retrySecondClaim = await claimCampaignOutbox(db, {
    workerId: 'retry-2', leaseMs: 10_000, maxAttempts: 1, now: retrySecondAt,
  });
  assert.equal(retrySecondClaim?.attempt, 2);
  assert.equal(retrySecondClaim.maxAttempts, 3, 'a logical restart must preserve the cycle snapshot');
  assert.equal(await failCampaignOutbox(db, retrySecondClaim, { ...policy, maxAttempts: 1 }, retrySecondAt), 'RETRY');
  const retryThirdAt = new Date(retrySecondAt.getTime() + 2_000);
  const retryThirdClaim = await claimCampaignOutbox(db, {
    workerId: 'retry-3', leaseMs: 10_000, maxAttempts: 8, now: retryThirdAt,
  });
  assert.equal(retryThirdClaim?.attempt, 3);
  assert.equal(retryThirdClaim.maxAttempts, 3);
  assert.equal(await failCampaignOutbox(second.db, { ...retryThirdClaim, token: crypto.randomUUID() }, policy, retryThirdAt), 'STALE');
  assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value FROM campaign_dead_letters
    WHERE outbox_id = ${retryItem.id}::uuid`))[0]?.value, 0, 'a stale worker must not create a dead-letter');
  assert.equal(await failCampaignOutbox(db, retryThirdClaim, policy, retryThirdAt), 'DEAD_LETTERED');
  const exhaustedRow = (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id)))[0]!;
  assert.equal(exhaustedRow.status, 'EXHAUSTED');
  assert.equal(exhaustedRow.claimWorkerId, null); assert.equal(exhaustedRow.claimToken, null);
  assert.equal(exhaustedRow.claimedAt, null); assert.equal(exhaustedRow.claimExpiresAt, null);

  const concurrentSnapshotAt = new Date('2000-01-12T13:00:00.000Z');
  const concurrentSnapshotItem = await insertItem(concurrentSnapshotAt);
  const concurrentSnapshotClaims = await Promise.all([
    claimCampaignOutbox(db, {
      workerId: 'snapshot-concurrency-a', leaseMs: 10_000, maxAttempts: 2, now: concurrentSnapshotAt,
    }),
    claimCampaignOutbox(second.db, {
      workerId: 'snapshot-concurrency-b', leaseMs: 10_000, maxAttempts: 7, now: concurrentSnapshotAt,
    }),
  ]);
  const winningSnapshotClaim = concurrentSnapshotClaims.find((claim) => claim?.id === concurrentSnapshotItem.id);
  assert.ok(winningSnapshotClaim, 'one concurrent worker must claim and snapshot the item');
  assert.equal(concurrentSnapshotClaims.filter((claim) => claim?.id === concurrentSnapshotItem.id).length, 1);
  const concurrentSnapshotRow = (
    await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, concurrentSnapshotItem.id))
  )[0]!;
  assert.equal(concurrentSnapshotRow.maxAttemptsSnapshot, winningSnapshotClaim.maxAttempts,
    'the atomic claim must persist the winning worker configuration exactly once');
  assert.equal(await completeCampaignOutbox(db, winningSnapshotClaim, concurrentSnapshotAt), true);

  const crashedAt = new Date('2000-01-13T12:00:00.000Z');
  const crashedItem = await insertItem(crashedAt);
  await db.update(campaignOutbox).set({ attempts: 2 }).where(eq(campaignOutbox.id, crashedItem.id));
  const crashedClaim = await claimCampaignOutbox(db, {
    workerId: 'crashed-final-attempt', leaseMs: 10_000, maxAttempts: 3, now: crashedAt,
  });
  assert.equal(crashedClaim?.attempt, 3);
  const afterCrashLease = new Date(crashedAt.getTime() + 10_001);
  assert.equal(await claimCampaignOutbox(second.db, {
    workerId: 'exhaustion-sweeper', leaseMs: 10_000, maxAttempts: 3, now: afterCrashLease,
  }), null);
  assert.equal((await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, crashedItem.id)))[0]?.status, 'EXHAUSTED');
  assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value FROM campaign_dead_letters
    WHERE outbox_id = ${crashedItem.id}::uuid`))[0]?.value, 1, 'expired final lease must create a dead-letter');

  const recoveryAt = new Date('2000-01-14T12:00:00.000Z');
  const deadLetter = (await db.execute<{ id: string }>(sql`SELECT id FROM campaign_dead_letters
    WHERE outbox_id = ${retryItem.id}::uuid AND cycle = 0`))[0]!;
  const recoveryInput = {
    deadLetterId: deadLetter.id, actor: 'integration-admin', reason: 'verified simulated recovery',
    idempotencyKey: `recover-${retryItem.id}`, now: recoveryAt, availableAt: recoveryAt,
  };
  const recoveredDeadLetter = await recoverCampaignDeadLetter(db, recoveryInput);
  assert.equal(recoveredDeadLetter.replayed, false);
  assert.equal((await recoverCampaignDeadLetter(second.db, recoveryInput)).replayed, true);
  await assert.rejects(() => recoverCampaignDeadLetter(db, { ...recoveryInput, reason: 'divergent' }),
    (error: unknown) => error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT');
  const recoveredRow = (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id)))[0]!;
  assert.equal(recoveredRow.status, 'PENDING');
  assert.equal(recoveredRow.attempts, 0);
  assert.equal(recoveredRow.deadLetterCycle, 1);
  assert.equal(recoveredRow.maxAttemptsSnapshot, null);
  assert.equal(recoveredRow.claimWorkerId, null);

  let recoveredFailureAt = recoveryAt;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const recoveredClaim = await claimCampaignOutbox(db, {
      workerId: `recovered-failure-${attempt}`, leaseMs: 10_000, maxAttempts: policy.maxAttempts + 1, now: recoveredFailureAt,
    });
    assert.equal(recoveredClaim?.id, retryItem.id);
    assert.equal(recoveredClaim.maxAttempts, policy.maxAttempts + 1, 'a recovered cycle must take a new snapshot');
    const decision = await failCampaignOutbox(db, recoveredClaim, policy, recoveredFailureAt);
    assert.equal(decision, 'RETRY');
    if (attempt < policy.maxAttempts) {
      recoveredFailureAt = (await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id)))[0]!.availableAt;
    }
  }
  const recoveredFinalAt = (
    await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, retryItem.id))
  )[0]!.availableAt;
  const recoveredFinalClaim = await claimCampaignOutbox(db, {
    workerId: 'recovered-failure-final', leaseMs: 10_000, maxAttempts: 2,
    now: recoveredFinalAt,
  });
  assert.equal(recoveredFinalClaim?.attempt, 4);
  assert.equal(recoveredFinalClaim.maxAttempts, 4);
  assert.equal(await failCampaignOutbox(db, recoveredFinalClaim, policy, recoveredFinalAt), 'DEAD_LETTERED');
  const cycles = await db.execute<{ cycle: number }>(sql`SELECT cycle FROM campaign_dead_letters
    WHERE outbox_id = ${retryItem.id}::uuid ORDER BY cycle`);
  assert.deepEqual(cycles.map((row) => row.cycle), [0, 1], 'a new definitive failure must preserve the previous cycle');

  const competingItem = await insertItem(recoveryAt);
  await db.update(campaignOutbox).set({ status: 'EXHAUSTED' }).where(eq(campaignOutbox.id, competingItem.id));
  const competingDead = (await db.execute<{ id: string }>(sql`INSERT INTO campaign_dead_letters
    (outbox_id, cycle, correlation_id, payload, error, error_code, attempts, claim_generation, created_at)
    VALUES (${competingItem.id}::uuid, 0, 'concurrent-recovery', '{}'::jsonb, 'SIMULATED_EXECUTION_FAILED',
      'SIMULATED_EXECUTION_FAILED', 3, 1, ${recoveryAt.toISOString()}::timestamptz) RETURNING id`))[0]!;
  const competing = await Promise.allSettled([
    recoverCampaignDeadLetter(db, { deadLetterId: competingDead.id, actor: 'admin-a', reason: 'race', idempotencyKey: `race-a-${competingItem.id}`, now: recoveryAt }),
    recoverCampaignDeadLetter(second.db, { deadLetterId: competingDead.id, actor: 'admin-b', reason: 'race', idempotencyKey: `race-b-${competingItem.id}`, now: recoveryAt }),
  ]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1, 'only one concurrent recovery wins a cycle');
  const successfulRecoveredClaim = await claimCampaignOutbox(db, {
    workerId: 'successful-recovery', leaseMs: 10_000, maxAttempts: 3, now: recoveryAt,
  });
  assert.equal(successfulRecoveredClaim?.id, competingItem.id);
  assert.equal(await completeCampaignOutbox(db, successfulRecoveredClaim, recoveryAt), true,
    'a recovered item can execute successfully');

  const confirmationAt = new Date('2000-01-15T12:00:00.000Z');
  const confirmationOutboxId = await insertExecutableAttempt('EMAIL', confirmationAt);
  const confirmationClaim = await claimCampaignOutbox(db, {
    workerId: 'confirmation-worker', leaseMs: 10_000, maxAttempts: 3, now: confirmationAt,
  });
  assert.equal(confirmationClaim?.id, confirmationOutboxId);
  const confirmationAuthorization = await authorizeCampaignExecution(db, confirmationClaim, racePolicy, confirmationAt);
  assert.equal(confirmationAuthorization.decision, 'STARTED');
  if (confirmationAuthorization.decision === 'STARTED') {
    const confirmationInput = { executionId: confirmationAuthorization.executionId, outboxId: confirmationClaim.id,
      cycle: confirmationClaim.deadLetterCycle, attemptId: confirmationAuthorization.attemptId,
      channel: confirmationAuthorization.channel, workerId: confirmationClaim.workerId,
      token: confirmationClaim.token, generation: confirmationClaim.generation, confirmedAt: confirmationAt };
    await assert.rejects(() => confirmSimulatedCampaignExecution(second.db, {
      ...confirmationInput, token: crypto.randomUUID(),
    }), (error: unknown) => error instanceof Error && error.message === 'SIMULATED_CONFIRMATION_STALE');
    assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value
      FROM campaign_simulated_confirmations WHERE outbox_id = ${confirmationClaim.id}::uuid`))[0]?.value, 0,
    'a stale worker must not persist a simulated confirmation');
    assert.equal((await confirmSimulatedCampaignExecution(db, confirmationInput)).replayed, false);
    assert.equal((await confirmSimulatedCampaignExecution(second.db, confirmationInput)).replayed, true);
    assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value
      FROM campaign_simulated_confirmations WHERE outbox_id = ${confirmationClaim.id}::uuid AND cycle = 0`))[0]?.value, 1);
    const restartedAt = new Date(confirmationAt.getTime() + 10_001);
    const restartedClaim = await claimCampaignOutbox(second.db, {
      workerId: 'confirmation-restart', leaseMs: 10_000, maxAttempts: 3, now: restartedAt,
    });
    assert.equal(restartedClaim?.id, confirmationClaim.id, 'confirmation without ACK is recovered after lease expiry');
    const restartedAuthorization = await authorizeCampaignExecution(second.db, restartedClaim, racePolicy, restartedAt);
    assert.equal(restartedAuthorization.decision, 'STARTED');
    if (restartedAuthorization.decision === 'STARTED') {
      assert.equal(restartedAuthorization.executionId, confirmationAuthorization.executionId);
      assert.equal((await confirmSimulatedCampaignExecution(second.db, {
        ...confirmationInput, workerId: restartedClaim.workerId, token: restartedClaim.token,
        generation: restartedClaim.generation, confirmedAt: restartedAt,
      })).replayed, true);
    }
    assert.equal(await completeCampaignOutbox(second.db, restartedClaim, restartedAt), true);
  }

  const finalConfirmationAt = new Date('2000-01-16T12:00:00.000Z');
  const finalConfirmationId = await insertExecutableAttempt('EMAIL', finalConfirmationAt);
  await db.update(campaignOutbox).set({ attempts: 2 }).where(eq(campaignOutbox.id, finalConfirmationId));
  const finalConfirmationClaim = await claimCampaignOutbox(db, {
    workerId: 'confirmed-final-attempt', leaseMs: 10_000, maxAttempts: 3, now: finalConfirmationAt,
  });
  assert.equal(finalConfirmationClaim?.attempt, 3);
  const finalConfirmationAuthorization = await authorizeCampaignExecution(
    db, finalConfirmationClaim, racePolicy, finalConfirmationAt,
  );
  assert.equal(finalConfirmationAuthorization.decision, 'STARTED');
  if (finalConfirmationAuthorization.decision === 'STARTED') {
    assert.equal((await confirmSimulatedCampaignExecution(db, {
      executionId: finalConfirmationAuthorization.executionId, outboxId: finalConfirmationClaim.id,
      cycle: finalConfirmationClaim.deadLetterCycle, attemptId: finalConfirmationAuthorization.attemptId,
      channel: finalConfirmationAuthorization.channel, workerId: finalConfirmationClaim.workerId,
      token: finalConfirmationClaim.token, generation: finalConfirmationClaim.generation,
      confirmedAt: finalConfirmationAt,
    })).replayed, false);
  }
  await claimCampaignOutbox(second.db, {
    workerId: 'confirmed-final-sweeper', leaseMs: 10_000, maxAttempts: 3,
    now: new Date(finalConfirmationAt.getTime() + 10_001),
  });
  const finalConfirmationRow = (
    await db.select().from(campaignOutbox).where(eq(campaignOutbox.id, finalConfirmationId))
  )[0]!;
  assert.equal(finalConfirmationRow.status, 'PUBLISHED',
    'an expired final lease with a durable confirmation must be reconciled instead of dead-lettered');
  assert.ok(finalConfirmationRow.publishedAt);
  assert.equal((await db.execute<{ value: number }>(sql`SELECT count(*)::int AS value
    FROM campaign_dead_letters WHERE outbox_id = ${finalConfirmationId}::uuid`))[0]?.value, 0);

  console.log('Campaign outbox integration evidence: contested=1, parallel=2, future=blocked, activeLease=protected, expiredLease=recovered, staleAck=rejected, restart=preserved, ordering=deterministic, staleConfirmation=rejected, confirmedFinalLease=reconciled');
} finally {
  await second.close();
  await close();
}
