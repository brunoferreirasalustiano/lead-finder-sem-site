import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { nextCampaignExecutionInstant, type CampaignChannel } from '@lead-finder/shared';
import type { Database } from './index.js';

export interface OutboxClaim {
  id: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  workerId: string;
  token: string;
  generation: number;
  attempt: number;
  expiresAt: Date;
}

export interface CampaignExecutionPolicy {
  dailyLimitEmail: number;
  dailyLimitWhatsapp: number;
  minSpacingMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  windowStartUtc: string;
  windowEndUtc: string;
}

export interface ClaimOutboxInput {
  workerId: string;
  leaseMs: number;
  maxAttempts: number;
  now?: Date;
  token?: string;
}

export type ExecutionAuthorization =
  | { decision: 'STARTED'; channel: CampaignChannel; attemptId: string; startedAt: Date }
  | { decision: 'ADMINISTRATIVE' }
  | { decision: 'RESCHEDULED'; channel: CampaignChannel; availableAt: Date; reason: 'DAILY_LIMIT' | 'SPACING' }
  | { decision: 'INELIGIBLE'; channel: CampaignChannel; reason: string }
  | { decision: 'STALE' };

export function outboxLeaseExpiration(now: Date, leaseMs: number): Date {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) {
    throw new RangeError('leaseMs must be an integer between 1000 and 3600000');
  }
  return new Date(now.getTime() + leaseMs);
}

export function deterministicRetryAt(now: Date, attempt: number, baseMs: number, maxMs: number): Date {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  const delay = Math.min(baseMs * (2 ** Math.min(attempt - 1, 52)), maxMs);
  return new Date(now.getTime() + delay);
}

const validWorkerId = (workerId: string) => {
  const normalized = workerId.trim();
  if (!normalized || normalized.length > 200) throw new RangeError('workerId must contain 1 to 200 characters');
  return normalized;
};

export async function claimCampaignOutbox(db: Database, input: ClaimOutboxInput): Promise<OutboxClaim | null> {
  const workerId = validWorkerId(input.workerId);
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');
  const now = input.now ?? new Date();
  const expiresAt = outboxLeaseExpiration(now, input.leaseMs);
  const token = input.token ?? randomUUID();
  const rows = await db.execute<{
    id: string; event_type: string; payload: unknown; idempotency_key: string; attempts: number;
    claim_generation: number; claim_expires_at: Date | string;
  }>(sql`
    WITH candidate AS (
      SELECT id FROM campaign_outbox
      WHERE status = 'PENDING' AND attempts < ${input.maxAttempts}
        AND available_at <= ${now.toISOString()}::timestamptz
        AND (claim_expires_at IS NULL OR claim_expires_at <= ${now.toISOString()}::timestamptz)
      ORDER BY available_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE campaign_outbox AS outbox
    SET claim_worker_id = ${workerId}, claim_token = ${token}::uuid,
        claim_generation = outbox.claim_generation + 1, claimed_at = ${now.toISOString()}::timestamptz,
        claim_expires_at = ${expiresAt.toISOString()}::timestamptz, attempts = outbox.attempts + 1
    FROM candidate WHERE outbox.id = candidate.id
    RETURNING outbox.id, outbox.event_type, outbox.payload, outbox.idempotency_key, outbox.attempts,
              outbox.claim_generation, outbox.claim_expires_at
  `);
  const row = rows[0];
  return row ? {
    id: row.id, eventType: row.event_type, payload: row.payload, idempotencyKey: row.idempotency_key,
    workerId, token, generation: row.claim_generation, attempt: row.attempts,
    expiresAt: new Date(row.claim_expires_at),
  } : null;
}

const stalePredicate = (claim: Pick<OutboxClaim, 'id' | 'workerId' | 'token' | 'generation'>, now: Date) => sql`
  id = ${claim.id}::uuid AND status = 'PENDING' AND claim_worker_id = ${claim.workerId}
  AND claim_token = ${claim.token}::uuid AND claim_generation = ${claim.generation}
  AND claim_expires_at > ${now.toISOString()}::timestamptz
`;
const joinedStalePredicate = (claim: Pick<OutboxClaim, 'id' | 'workerId' | 'token' | 'generation'>, now: Date) => sql`
  o.id = ${claim.id}::uuid AND o.status = 'PENDING' AND o.claim_worker_id = ${claim.workerId}
  AND o.claim_token = ${claim.token}::uuid AND o.claim_generation = ${claim.generation}
  AND o.claim_expires_at > ${now.toISOString()}::timestamptz
`;

export async function authorizeCampaignExecution(
  db: Database,
  claim: OutboxClaim,
  policy: CampaignExecutionPolicy,
  now = new Date(),
): Promise<ExecutionAuthorization> {
  if (claim.eventType !== 'ATTEMPT_CREATED') {
    const valid = await db.execute<{ id: string }>(sql`SELECT id FROM campaign_outbox WHERE ${stalePredicate(claim, now)}`);
    return valid.length === 1 ? { decision: 'ADMINISTRATIVE' } : { decision: 'STALE' };
  }
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      outbox_id: string; attempt_id: string; channel: string; campaign_state: string; recipient_state: string;
      attempt_state: string; is_blocked: boolean; do_not_contact: boolean; crm_stage: string | null;
      has_opt_out: boolean; has_response: boolean;
    }>(sql`
      SELECT o.id AS outbox_id, a.id AS attempt_id, r.channel, c.state AS campaign_state,
             r.state AS recipient_state, a.state AS attempt_state, l.is_blocked, l.do_not_contact, l.crm_stage,
             EXISTS (SELECT 1 FROM campaign_opt_outs oo WHERE oo.lead_id = l.id AND (oo.channel IS NULL OR oo.channel = r.channel)) AS has_opt_out,
             (l.crm_stage IN ('RESPONDEU', 'REUNIAO', 'PROPOSTA', 'GANHO')) AS has_response
      FROM campaign_outbox o
      JOIN campaign_attempts a ON o.aggregate_type = 'attempt' AND a.id = o.aggregate_id
      JOIN campaign_recipients r ON r.id = a.recipient_id
      JOIN campaigns c ON c.id = r.campaign_id
      JOIN leads l ON l.id = r.lead_id
      WHERE ${joinedStalePredicate(claim, now)} AND o.event_type = 'ATTEMPT_CREATED'
      FOR UPDATE OF o, a, r, c, l
    `);
    const row = rows[0];
    if (!row) return { decision: 'STALE' };
    const channel = row.channel as CampaignChannel;
    const reason = row.campaign_state !== 'ATIVA' ? 'CAMPAIGN_NOT_ACTIVE'
      : !['ELEGIVEL', 'EM_ANDAMENTO'].includes(row.recipient_state) ? 'RECIPIENT_NOT_EXECUTABLE'
      : !['PENDENTE', 'APROVADA'].includes(row.attempt_state) ? 'ATTEMPT_NOT_EXECUTABLE'
      : row.is_blocked ? 'LEAD_BLOCKED'
      : row.do_not_contact ? 'DO_NOT_CONTACT'
      : row.crm_stage === 'NAO_CONTATAR' ? 'CRM_DO_NOT_CONTACT'
      : row.has_opt_out ? 'OPT_OUT'
      : row.has_response ? 'ALREADY_RESPONDED'
      : null;
    if (reason) {
      await tx.execute(sql`UPDATE campaign_outbox SET claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL,
        claim_expires_at = NULL, status = 'BLOCKED' WHERE ${stalePredicate(claim, now)}`);
      return { decision: 'INELIGIBLE', channel, reason };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('campaign-channel:' || ${channel}))`);
    const alreadyStarted = await tx.execute<{ started_at: Date | string; attempt_id: string; channel: CampaignChannel }>(sql`
      SELECT started_at, attempt_id, channel FROM campaign_execution_starts WHERE outbox_id = ${claim.id}::uuid
    `);
    if (alreadyStarted[0]) return {
      decision: 'STARTED', channel: alreadyStarted[0].channel, attemptId: alreadyStarted[0].attempt_id,
      startedAt: new Date(alreadyStarted[0].started_at),
    };
    const runtime = await tx.execute<{ next_available_at: Date | string | null }>(sql`
      SELECT next_available_at FROM campaign_channel_runtime WHERE channel = ${channel} FOR UPDATE
    `);
    const nextAllowedAt = nextCampaignExecutionInstant(
      now,
      { startUtc: policy.windowStartUtc, endUtc: policy.windowEndUtc },
      0,
      runtime[0]?.next_available_at ? new Date(runtime[0].next_available_at) : null,
    );
    if (nextAllowedAt > now) {
      await rescheduleClaim(tx as unknown as Database, claim, nextAllowedAt, now);
      return { decision: 'RESCHEDULED', channel, availableAt: nextAllowedAt, reason: 'SPACING' };
    }
    const quotaDay = now.toISOString().slice(0, 10);
    const limit = channel === 'EMAIL' ? policy.dailyLimitEmail : policy.dailyLimitWhatsapp;
    const quota = await tx.execute<{ count: number }>(sql`
      INSERT INTO campaign_daily_channel_counters (channel, quota_day, count)
      VALUES (${channel}, ${quotaDay}::date, 0)
      ON CONFLICT (channel, quota_day) DO UPDATE SET channel = EXCLUDED.channel
      RETURNING count
    `);
    if ((quota[0]?.count ?? 0) >= limit) {
      const nextDay = new Date(`${quotaDay}T00:00:00.000Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      await rescheduleClaim(tx as unknown as Database, claim, nextDay, now);
      return { decision: 'RESCHEDULED', channel, availableAt: nextDay, reason: 'DAILY_LIMIT' };
    }
    await tx.execute(sql`UPDATE campaign_daily_channel_counters SET count = count + 1, updated_at = ${now.toISOString()}::timestamptz
      WHERE channel = ${channel} AND quota_day = ${quotaDay}::date`);
    const nextSpacingAt = nextCampaignExecutionInstant(
      now,
      { startUtc: policy.windowStartUtc, endUtc: policy.windowEndUtc },
      policy.minSpacingMs,
      now,
    );
    await tx.execute(sql`INSERT INTO campaign_channel_runtime (channel, next_available_at) VALUES (${channel}, ${nextSpacingAt.toISOString()}::timestamptz)
      ON CONFLICT (channel) DO UPDATE SET next_available_at = EXCLUDED.next_available_at, updated_at = ${now.toISOString()}::timestamptz`);
    await tx.execute(sql`INSERT INTO campaign_execution_starts
      (outbox_id, attempt_id, channel, quota_day, started_at, claim_generation)
      VALUES (${claim.id}::uuid, ${row.attempt_id}::uuid, ${channel}, ${quotaDay}::date, ${now.toISOString()}::timestamptz, ${claim.generation})`);
    return { decision: 'STARTED', channel, attemptId: row.attempt_id, startedAt: now };
  });
}

async function rescheduleClaim(db: Database, claim: OutboxClaim, availableAt: Date, now: Date): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`UPDATE campaign_outbox SET available_at = ${availableAt.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE ${stalePredicate(claim, now)} RETURNING id`);
  return rows.length === 1;
}

export async function rescheduleCampaignOutbox(db: Database, claim: OutboxClaim, availableAt: Date, now = new Date()): Promise<boolean> {
  return rescheduleClaim(db, claim, availableAt, now);
}

export async function failCampaignOutbox(db: Database, claim: OutboxClaim, policy: CampaignExecutionPolicy, now = new Date()): Promise<'RETRY' | 'EXHAUSTED' | 'STALE'> {
  const exhausted = claim.attempt >= policy.maxAttempts;
  const availableAt = deterministicRetryAt(now, claim.attempt, policy.retryBaseMs, policy.retryMaxMs);
  const rows = await db.execute<{ id: string }>(sql`UPDATE campaign_outbox SET
    status = ${exhausted ? 'EXHAUSTED' : 'PENDING'}, available_at = ${availableAt.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE ${stalePredicate(claim, now)} RETURNING id`);
  return rows.length === 0 ? 'STALE' : exhausted ? 'EXHAUSTED' : 'RETRY';
}

export async function completeCampaignOutbox(db: Database, claim: Pick<OutboxClaim, 'id' | 'workerId' | 'token' | 'generation'>, now = new Date()): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`UPDATE campaign_outbox SET status = 'PUBLISHED', published_at = ${now.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE ${stalePredicate(claim, now)} RETURNING id`);
  return rows.length === 1;
}
