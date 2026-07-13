import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { claimCampaignOutbox, completeCampaignOutbox } from './campaign-outbox.js';
import { createDatabase } from './index.js';
import { campaignOutbox } from './schema.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for campaign outbox integration tests');
const { db, close } = createDatabase(databaseUrl);
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
  claimCampaignOutbox(db, { workerId, leaseMs: 10_000, now, token });

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

  console.log('Campaign outbox integration evidence: contested=1, parallel=2, future=blocked, activeLease=protected, expiredLease=recovered, staleAck=rejected, restart=preserved, ordering=deterministic');
} finally {
  await close();
}
