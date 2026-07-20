import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './index.js';
import type { OutboxClaim } from './campaign-outbox.js';

export type ExecutionSource = 'oracle-vps' | 'supabase-render';

export async function beginBatchInvocation(db: Database, key: string, source: ExecutionSource): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new RangeError('invalid idempotency key');
  const rows = await db.execute<{ idempotency_key: string }>(sql`INSERT INTO batch_invocations
    (idempotency_key, execution_source) VALUES (${key}, ${source})
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key`);
  return rows.length === 1;
}

const assertExecutor = (value: string) => {
  const executor = value.trim();
  if (!executor || executor.length > 200) throw new RangeError('executorId must contain 1 to 200 characters');
  return executor;
};

export async function acquireProcessorLeadership(db: Database, input: {
  source: ExecutionSource; executorId: string; leaseMs: number; now?: Date;
}): Promise<{ acquired: boolean; token?: string; generation?: number }> {
  const executorId = assertExecutor(input.executorId);
  const now = input.now ?? new Date();
  const token = randomUUID();
  const expiresAt = new Date(now.getTime() + input.leaseMs);
  const rows = await db.execute<{ lease_token: string; generation: number }>(sql`
    INSERT INTO processor_leadership (queue_name, active_source, executor_id, lease_token, lease_expires_at, updated_at)
    VALUES ('campaign-outbox', ${input.source}, ${executorId}, ${token}::uuid, ${expiresAt.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (queue_name) DO UPDATE SET
      active_source = EXCLUDED.active_source, executor_id = EXCLUDED.executor_id,
      lease_token = EXCLUDED.lease_token, lease_expires_at = EXCLUDED.lease_expires_at,
      generation = processor_leadership.generation + 1, updated_at = EXCLUDED.updated_at
    WHERE processor_leadership.lease_expires_at <= EXCLUDED.updated_at
       OR (processor_leadership.active_source = EXCLUDED.active_source AND processor_leadership.executor_id = EXCLUDED.executor_id)
    RETURNING lease_token, generation
  `);
  const acquired = rows[0];
  if (!acquired) return { acquired: false };
  await db.execute(sql`INSERT INTO processor_leadership_audit
    (queue_name, source, executor_fingerprint, generation, event, occurred_at)
    VALUES ('campaign-outbox', ${input.source}, ${createHash('sha256').update(executorId).digest('hex').slice(0, 16)},
      ${acquired.generation}, 'ACQUIRED', ${now.toISOString()}::timestamptz)`);
  return { acquired: true, token: acquired.lease_token, generation: acquired.generation };
}

export async function reserveDailyLeadAllocation(db: Database, claim: OutboxClaim, input: {
  source: ExecutionSource; configuredLimit: number; now?: Date;
}): Promise<'RESERVED' | 'REPLAY' | 'LIMIT_REACHED'> {
  const now = input.now ?? new Date();
  const limit = Math.min(60, Math.max(1, Math.trunc(input.configuredLimit)));
  return db.transaction(async (tx) => {
    const replay = await tx.execute<{ found: boolean }>(sql`SELECT true AS found FROM deployment_daily_lead_allocations
      WHERE outbox_id = ${claim.id}::uuid AND dead_letter_cycle = ${claim.deadLetterCycle}`);
    if (replay[0]) return 'REPLAY';
    const day = now.toISOString().slice(0, 10);
    await tx.execute(sql`INSERT INTO deployment_daily_lead_counters (quota_day) VALUES (${day}::date)
      ON CONFLICT (quota_day) DO NOTHING`);
    const counter = await tx.execute<{ count: number }>(sql`SELECT count FROM deployment_daily_lead_counters
      WHERE quota_day = ${day}::date FOR UPDATE`);
    if ((counter[0]?.count ?? 60) >= limit) {
      const nextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      await tx.execute(sql`UPDATE campaign_outbox SET available_at = ${nextUtcDay.toISOString()}::timestamptz,
        claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
        WHERE id = ${claim.id}::uuid AND claim_worker_id = ${claim.workerId}
          AND claim_token = ${claim.token}::uuid AND claim_generation = ${claim.generation}`);
      return 'LIMIT_REACHED';
    }
    await tx.execute(sql`INSERT INTO deployment_daily_lead_allocations
      (outbox_id, dead_letter_cycle, quota_day, execution_source)
      VALUES (${claim.id}::uuid, ${claim.deadLetterCycle}, ${day}::date, ${input.source})`);
    await tx.execute(sql`UPDATE deployment_daily_lead_counters SET count = count + 1,
      updated_at = ${now.toISOString()}::timestamptz WHERE quota_day = ${day}::date`);
    return 'RESERVED';
  });
}
