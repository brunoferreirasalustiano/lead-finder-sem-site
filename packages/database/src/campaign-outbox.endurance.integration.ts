import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import {
  claimCampaignOutbox,
  completeCampaignOutbox,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
  type OutboxClaim,
} from './campaign-outbox.js';
import { createDatabase } from './index.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for campaign outbox endurance tests');

const { db, close } = createDatabase(databaseUrl);
const peer = createDatabase(databaseUrl);
const policy: CampaignExecutionPolicy = {
  dailyLimitEmail: 100_000, dailyLimitWhatsapp: 100_000, minSpacingMs: 0, maxAttempts: 3,
  retryBaseMs: 1_000, retryMaxMs: 1_000, windowStartUtc: '00:00', windowEndUtc: '23:59',
};
const base = Date.UTC(2040, 0, 1);
const at = (offset: number) => new Date(base + offset);
const maxScenarioMs = 180_000;
let markerSequence = 0;

const marker = (name: string) => `endurance-${name}-${markerSequence += 1}-${crypto.randomUUID()}`;

const withinBudget = async <T>(name: string, run: () => Promise<T>) => {
  const started = process.hrtime.bigint();
  const result = await run();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  assert.ok(elapsedMs < maxScenarioMs, `${name} exceeded the ${maxScenarioMs}ms endurance regression budget (${elapsedMs.toFixed(0)}ms)`);
  return result;
};

const insertItems = async (aggregateType: string, count: number, availableAt: Date) => {
  await db.execute(sql`
    INSERT INTO campaign_outbox
      (aggregate_type, aggregate_id, event_type, payload, idempotency_key, payload_fingerprint, available_at)
    SELECT ${aggregateType}, gen_random_uuid(), 'SIMULATED', jsonb_build_object('fixture', item),
      ${aggregateType} || '-' || item::text, ${'f'.repeat(64)}, ${availableAt.toISOString()}::timestamptz
    FROM generate_series(1, ${count}) AS item
  `);
};

const counts = async (aggregateType: string) => {
  const rows = await db.execute<{ status: string; value: number }>(sql`
    SELECT status, count(*)::int AS value FROM campaign_outbox
    WHERE aggregate_type = ${aggregateType} GROUP BY status
  `);
  return new Map(rows.map((row) => [row.status, row.value]));
};

const pendingItems = async () => (await db.execute<{ value: number }>(sql`
  SELECT count(*)::int AS value FROM campaign_outbox WHERE status = 'PENDING'
`))[0]?.value ?? 0;

const assertTerminalQueue = async (aggregateType: string, expected: number, status = 'PUBLISHED') => {
  const result = await counts(aggregateType);
  assert.equal(result.get(status), expected, `${aggregateType}: every item must reach ${status}`);
  assert.equal(result.get('PENDING') ?? 0, 0, `${aggregateType}: no pending item may remain stuck`);
  assert.equal(result.get('EXHAUSTED') ?? 0, 0, `${aggregateType}: queue must not grow unexpectedly`);
};

const claim = (workerId: string, now: Date, maxAttempts = policy.maxAttempts) =>
  claimCampaignOutbox(db, { workerId, leaseMs: 1_000, maxAttempts, now });

try {
  await withinBudget('10000 sequential items', async () => {
    const aggregateType = marker('sequential');
    const now = at(0);
    const pendingBefore = await pendingItems();
    await insertItems(aggregateType, 10_000, now);
    let ownItemsCompleted = 0;
    for (let index = 0; ownItemsCompleted < 10_000; index += 1) {
      assert.ok(index < pendingBefore + 10_000, 'only pre-existing work may precede the endurance fixture');
      const current = await claim(`sequential-${index % 16}`, now);
      assert.ok(current, `sequential claim ${index} must find work`);
      assert.equal(current.maxAttempts, 3);
      assert.equal(await completeCampaignOutbox(db, current, now), true);
      if (current.idempotencyKey.startsWith(aggregateType)) ownItemsCompleted += 1;
    }
    await assertTerminalQueue(aggregateType, 10_000);
  });

  await withinBudget('1000 concurrent items and 30 contention repetitions', async () => {
    const aggregateType = marker('concurrent');
    const now = at(10_000);
    await insertItems(aggregateType, 1_000, now);
    const claims = await Promise.all(Array.from({ length: 1_000 }, (_, index) =>
      claimCampaignOutbox(index % 2 === 0 ? db : peer.db, {
        workerId: `concurrent-${index % 64}`, leaseMs: 1_000, maxAttempts: 3, now,
      }),
    ));
    assert.equal(claims.filter(Boolean).length, 1_000, 'all 1000 concurrent items must be claimed');
    assert.equal(new Set(claims.map((item) => item?.id)).size, 1_000, 'concurrent claims must not duplicate an item');
    await Promise.all(claims.map((item) => completeCampaignOutbox(db, item!, now)));
    await assertTerminalQueue(aggregateType, 1_000);

    for (let run = 0; run < 30; run += 1) {
      const contested = marker(`contention-${run}`);
      const runNow = at(20_000 + run * 2_000);
      await insertItems(contested, 1, runNow);
      const contenders = await Promise.all(Array.from({ length: 32 }, (_, index) =>
        claimCampaignOutbox(index % 2 === 0 ? db : peer.db, {
          workerId: `contention-${run}-${index}`, leaseMs: 1_000, maxAttempts: 3, now: runNow,
        }),
      ));
      const winners = contenders.filter(Boolean);
      assert.equal(winners.length, 1, `contention run ${run}: exactly one lease must be created`);
      assert.equal(await completeCampaignOutbox(db, winners[0]!, runNow), true);
      await assertTerminalQueue(contested, 1);
    }
  });

  await withinBudget('thousands of retries with immutable snapshots', async () => {
    const aggregateType = marker('retries');
    const firstAt = at(100_000);
    await insertItems(aggregateType, 2_000, firstAt);
    for (let index = 0; index < 2_000; index += 1) {
      const first = await claim(`retry-first-${index % 16}`, firstAt, 7);
      assert.ok(first);
      assert.equal(first.maxAttempts, 7);
      assert.equal(await failCampaignOutbox(db, first, policy, firstAt), 'RETRY');
    }
    const retryAt = at(101_000);
    for (let index = 0; index < 2_000; index += 1) {
      const retried = await claim(`retry-second-${index % 16}`, retryAt, 2);
      assert.ok(retried);
      assert.equal(retried.attempt, 2);
      assert.equal(retried.maxAttempts, 7, 'max_attempts_snapshot must survive config changes');
      assert.equal(await completeCampaignOutbox(db, retried, retryAt), true);
    }
    await assertTerminalQueue(aggregateType, 2_000);
  });

  await withinBudget('thousands of lease recoveries and frequent logical restarts', async () => {
    const aggregateType = marker('leases');
    const firstAt = at(200_000);
    await insertItems(aggregateType, 2_000, firstAt);
    const firstClaims: OutboxClaim[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const first = await claim(`lease-before-restart-${index % 32}`, firstAt, 5);
      assert.ok(first);
      firstClaims.push(first);
    }
    const restartedAt = at(201_000);
    for (let index = 0; index < firstClaims.length; index += 1) {
      const previous = firstClaims[index]!;
      const recovered = await claimCampaignOutbox(index % 2 === 0 ? db : peer.db, {
        workerId: `lease-after-restart-${index % 32}`, leaseMs: 1_000, maxAttempts: 2, now: restartedAt,
      });
      assert.ok(recovered);
      assert.equal(recovered.id, previous.id);
      assert.equal(recovered.generation, previous.generation + 1, 'each restart must advance generation exactly once');
      assert.equal(recovered.maxAttempts, 5, 'leases must retain their cycle snapshot');
      assert.equal(await completeCampaignOutbox(db, previous, restartedAt), false, 'pre-restart leases must be fenced');
      assert.equal(await completeCampaignOutbox(db, recovered, restartedAt), true);
    }
    await assertTerminalQueue(aggregateType, 2_000);
  });

  await withinBudget('dead-letter terminality under repeated failures', async () => {
    const aggregateType = marker('dead-letter');
    const firstAt = at(300_000);
    await insertItems(aggregateType, 1_000, firstAt);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const now = at(300_000 + (attempt - 1) * 1_000);
      for (let index = 0; index < 1_000; index += 1) {
        const failure = await claim(`dead-letter-${attempt}-${index % 16}`, now);
        assert.ok(failure);
        assert.equal(await failCampaignOutbox(db, failure, policy, now), attempt === 3 ? 'DEAD_LETTERED' : 'RETRY');
      }
    }
    const terminal = await counts(aggregateType);
    assert.equal(terminal.get('EXHAUSTED'), 1_000, 'every exhausted item must have one terminal dead-letter cycle');
    assert.equal(terminal.get('PENDING') ?? 0, 0, 'dead-lettered items must never remain queued');
    assert.equal(await claim('dead-letter-terminal-check', at(310_000)), null, 'dead-letter items must not be reclaimed');
    const letters = await db.execute<{ value: number }>(sql`
      SELECT count(*)::int AS value FROM campaign_dead_letters d
      JOIN campaign_outbox o ON o.id = d.outbox_id WHERE o.aggregate_type = ${aggregateType}
    `);
    assert.equal(letters[0]?.value, 1_000, 'dead-letter creation must remain exactly once per cycle');
  });

  console.log('Campaign outbox endurance evidence: sequential=10000, concurrent=1000, contention=30/30, retries=2000, leaseRecoveries=2000, generations=fenced, snapshots=immutable, deadLetter=terminal, queue=drained');
} finally {
  await peer.close();
  await close();
}
