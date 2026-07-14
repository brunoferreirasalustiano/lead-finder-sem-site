import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import {
  claimCampaignOutbox,
  createDatabase,
  failCampaignOutbox,
  type CampaignExecutionPolicy,
} from '@lead-finder/database';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const migrationDirectory = new URL('../database/migrations/', import.meta.url);
const migrationName = '0010_campaign_outbox_max_attempts_snapshot.sql';
const upgradeDatabaseName = `leadfinder_upgrade_0010_${process.pid}`;
const upgradeDatabaseUrl = new URL(databaseUrl);
upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`;
const startedAt = new Date('2000-02-01T12:00:00.000Z');
const expiredAt = new Date(startedAt.getTime() + 10_001);
const retryAt = new Date(expiredAt.getTime() + 10_000);
const firstClaimAt = new Date(retryAt.getTime() + 10_000);
const activeLeaseId = randomUUID();
const retryId = randomUUID();
const neverStartedId = randomUUID();

const policy: CampaignExecutionPolicy = {
  dailyLimitEmail: 10, dailyLimitWhatsapp: 10, minIntervalMsEmail: 0, minIntervalMsWhatsapp: 0,
  retryBaseMs: 1_000, retryMaxMs: 1_000, maxAttempts: 999,
};

const admin = postgres(databaseUrl, { max: 1 });
try {
  await admin.unsafe(`CREATE DATABASE "${upgradeDatabaseName}"`);
  const upgrade = postgres(upgradeDatabaseUrl.toString(), { max: 1 });
  try {
    for (const file of (await readdir(migrationDirectory)).filter((name) => name < migrationName).sort())
      await upgrade.unsafe(await readFile(new URL(file, migrationDirectory), 'utf8'));

    const insertLegacyOutbox = async (id: string, attempts: number, activeLease: boolean, availableAt: Date) => {
      await upgrade`
        INSERT INTO campaign_outbox (
          id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, payload_fingerprint,
          status, attempts, available_at, claim_worker_id, claim_token, claim_generation, claimed_at, claim_expires_at
        ) VALUES (
          ${id}::uuid, 'CAMPAIGN_ATTEMPT', ${randomUUID()}::uuid, 'CAMPAIGN_ATTEMPT_READY', '{}'::jsonb,
          ${`legacy-${id}`}, ${'0'.repeat(64)}, 'PENDING', ${attempts}, ${availableAt.toISOString()}::timestamptz,
          ${activeLease ? 'legacy-worker' : null}, ${activeLease ? randomUUID() : null}::uuid,
          ${activeLease ? 1 : 0}, ${activeLease ? startedAt.toISOString() : null}::timestamptz,
          ${activeLease ? new Date(startedAt.getTime() + 10_000).toISOString() : null}::timestamptz
        )`;
    };
    await insertLegacyOutbox(activeLeaseId, 2, true, startedAt);
    await insertLegacyOutbox(retryId, 1, false, retryAt);
    await insertLegacyOutbox(neverStartedId, 0, false, firstClaimAt);

    const migration = await readFile(new URL(migrationName, migrationDirectory), 'utf8');
    await upgrade.unsafe(migration);
    await upgrade.unsafe(migration);

    const snapshots = await upgrade<{ id: string; max_attempts_snapshot: number | null }[]>`
      SELECT id, max_attempts_snapshot FROM campaign_outbox WHERE id IN (${activeLeaseId}::uuid, ${retryId}::uuid, ${neverStartedId}::uuid)`;
    const snapshotFor = (id: string) => snapshots.find((row) => row.id === id)?.max_attempts_snapshot;
    assert.equal(snapshotFor(activeLeaseId), 2, 'an active legacy lease must finalize at its consumed attempt');
    assert.equal(snapshotFor(retryId), 2, 'a started legacy row must receive exactly one bounded final attempt');
    assert.equal(snapshotFor(neverStartedId), null, 'a never-started row must snapshot on its first claim');
  } finally {
    await upgrade.end();
  }

  const { db, close } = createDatabase(upgradeDatabaseUrl.toString());
  try {
    const finalization = await claimCampaignOutbox(db, {
      workerId: 'changed-config-finalizer', leaseMs: 10_000, maxAttempts: policy.maxAttempts, now: expiredAt,
    });
    assert.equal(finalization, null, 'an expired legacy final lease must not be revived by a changed worker setting');
    const finalized = await db.execute<{ status: string; dead_letters: number }>`
      SELECT o.status, count(d.id)::int AS dead_letters FROM campaign_outbox o
      LEFT JOIN campaign_dead_letters d ON d.outbox_id = o.id
      WHERE o.id = ${activeLeaseId}::uuid GROUP BY o.status`;
    assert.deepEqual(finalized[0], { status: 'EXHAUSTED', dead_letters: 1 });

    const retryClaim = await claimCampaignOutbox(db, {
      workerId: 'changed-config-retry', leaseMs: 10_000, maxAttempts: policy.maxAttempts, now: retryAt,
    });
    assert.equal(retryClaim?.id, retryId);
    assert.equal(retryClaim.maxAttempts, 2, 'a changed worker setting must not alter the legacy cycle limit');
    assert.equal(await failCampaignOutbox(db, retryClaim, policy, retryAt), 'DEAD_LETTERED');

    const firstClaim = await claimCampaignOutbox(db, {
      workerId: 'first-claim', leaseMs: 10_000, maxAttempts: 7, now: firstClaimAt,
    });
    assert.equal(firstClaim?.id, neverStartedId);
    assert.equal(firstClaim.maxAttempts, 7, 'a never-started row may snapshot its first worker configuration');
  } finally {
    await close();
  }
  console.log('Migration 0010 upgrade evidence: legacy leases finalized and legacy retries remained configuration-independent');
} finally {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${upgradeDatabaseName}"`);
  await admin.end();
}
