import { createHash, randomUUID } from 'node:crypto';
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
  maxAttempts: number;
  expiresAt: Date;
  deadLetterCycle: number;
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
  | { decision: 'STARTED'; channel: CampaignChannel; attemptId: string; executionId: string; startedAt: Date }
  | { decision: 'ADMINISTRATIVE' }
  | { decision: 'RESCHEDULED'; channel: CampaignChannel; availableAt: Date; reason: 'DAILY_LIMIT' | 'SPACING' }
  | { decision: 'INELIGIBLE'; channel?: CampaignChannel; reason: string }
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

export function resolveOutboxMaxAttemptsSnapshot(current: number | null, configured: number): number {
  if (!Number.isSafeInteger(configured) || configured < 1) throw new RangeError('maxAttempts must be a positive integer');
  if (current !== null && (!Number.isSafeInteger(current) || current < 1)) {
    throw new RangeError('maxAttempts snapshot must be a positive integer');
  }
  return current ?? configured;
}

const validWorkerId = (workerId: string) => {
  const normalized = workerId.trim();
  if (!normalized || normalized.length > 200) throw new RangeError('workerId must contain 1 to 200 characters');
  return normalized;
};

export async function claimCampaignOutbox(db: Database, input: ClaimOutboxInput): Promise<OutboxClaim | null> {
  const workerId = validWorkerId(input.workerId);
  const configuredMaxAttempts = resolveOutboxMaxAttemptsSnapshot(null, input.maxAttempts);
  const now = input.now ?? new Date();
  const expiresAt = outboxLeaseExpiration(now, input.leaseMs);
  const token = input.token ?? randomUUID();
  await finalizeExpiredFinalAttempt(db, configuredMaxAttempts, now);
  const rows = await db.execute<{
    id: string; event_type: string; payload: unknown; idempotency_key: string; attempts: number;
    claim_generation: number; claim_expires_at: Date | string; dead_letter_cycle: number; max_attempts_snapshot: number;
  }>(sql`
    WITH candidate AS (
      SELECT id FROM campaign_outbox
      WHERE status = 'PENDING' AND attempts < COALESCE(max_attempts_snapshot, ${configuredMaxAttempts})
        AND available_at <= ${now.toISOString()}::timestamptz
        AND (claim_expires_at IS NULL OR claim_expires_at <= ${now.toISOString()}::timestamptz)
      ORDER BY available_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE campaign_outbox AS outbox
    SET claim_worker_id = ${workerId}, claim_token = ${token}::uuid,
        claim_generation = outbox.claim_generation + 1, claimed_at = ${now.toISOString()}::timestamptz,
        claim_expires_at = ${expiresAt.toISOString()}::timestamptz, attempts = outbox.attempts + 1,
        max_attempts_snapshot = COALESCE(outbox.max_attempts_snapshot, ${configuredMaxAttempts})
    FROM candidate WHERE outbox.id = candidate.id
    RETURNING outbox.id, outbox.event_type, outbox.payload, outbox.idempotency_key, outbox.attempts,
              outbox.claim_generation, outbox.claim_expires_at, outbox.dead_letter_cycle,
              outbox.max_attempts_snapshot
  `);
  const row = rows[0];
  return row ? {
    id: row.id, eventType: row.event_type, payload: row.payload, idempotencyKey: row.idempotency_key,
    workerId, token, generation: row.claim_generation, attempt: row.attempts,
    maxAttempts: row.max_attempts_snapshot,
    expiresAt: new Date(row.claim_expires_at), deadLetterCycle: row.dead_letter_cycle,
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
    const identity = await tx.execute<{ lead_id: string; channel: CampaignChannel }>(sql`
      SELECT r.lead_id, r.channel
      FROM campaign_outbox o
      JOIN campaign_attempts a ON o.aggregate_type = 'attempt' AND a.id = o.aggregate_id
      JOIN campaign_recipients r ON r.id = a.recipient_id
      WHERE ${joinedStalePredicate(claim, now)} AND o.event_type = 'ATTEMPT_CREATED'
    `);
    if (!identity[0]) return { decision: 'STALE' };
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead:${identity[0].lead_id}:opt-out:${identity[0].channel}`}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead:${identity[0].lead_id}:opt-out:TODOS`}))`);
    const rows = await tx.execute<{
      outbox_id: string; attempt_id: string; lead_id: string; channel: string; campaign_state: string; recipient_state: string;
      attempt_state: string; is_blocked: boolean; do_not_contact: boolean; crm_stage: string | null;
      has_valid_contact: boolean; has_opt_out: boolean; has_response: boolean;
    }>(sql`
      SELECT o.id AS outbox_id, a.id AS attempt_id, l.id AS lead_id, r.channel, c.state AS campaign_state,
             r.state AS recipient_state, a.state AS attempt_state, l.is_blocked, l.do_not_contact, l.crm_stage,
             EXISTS (SELECT 1 FROM lead_contacts lc WHERE lc.lead_id = l.id AND lc.is_valid = true
               AND lc.verified_at IS NOT NULL AND (
                 (r.channel = 'EMAIL' AND lc.type = 'EMAIL') OR
                 (r.channel = 'WHATSAPP' AND lc.type = 'TELEFONE' AND lc.possible_whatsapp = true)
               )) AS has_valid_contact,
             EXISTS (SELECT 1 FROM campaign_opt_outs oo WHERE oo.lead_id = l.id AND (oo.channel IS NULL OR oo.channel = r.channel)) AS has_opt_out,
             (l.crm_stage IN ('RESPONDEU', 'REUNIAO', 'PROPOSTA', 'GANHO', 'PERDIDO')) AS has_response
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
    if (row.channel !== 'EMAIL' && row.channel !== 'WHATSAPP') {
      await tx.execute(sql`UPDATE campaign_outbox SET claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL,
        claim_expires_at = NULL, status = 'BLOCKED' WHERE ${stalePredicate(claim, now)}`);
      return { decision: 'INELIGIBLE', reason: 'INVALID_CHANNEL' };
    }
    const channel: CampaignChannel = row.channel;
    const alreadyStarted = await tx.execute<{ id: string; started_at: Date | string; attempt_id: string; channel: CampaignChannel; confirmed: boolean }>(sql`
      SELECT s.id, s.started_at, s.attempt_id, s.channel,
        EXISTS (SELECT 1 FROM campaign_simulated_confirmations c WHERE c.execution_id = s.id) AS confirmed
      FROM campaign_execution_starts s
      WHERE s.outbox_id = ${claim.id}::uuid AND s.cycle = ${claim.deadLetterCycle}
    `);
    if (alreadyStarted[0]?.confirmed) {
      return {
        decision: 'STARTED', channel: alreadyStarted[0].channel, attemptId: alreadyStarted[0].attempt_id,
        executionId: alreadyStarted[0].id, startedAt: new Date(alreadyStarted[0].started_at),
      };
    }
    const leadId = row.lead_id;
    const optOutAfterLock = await tx.execute<{ present: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM campaign_opt_outs WHERE lead_id = ${leadId}::uuid
        AND (channel IS NULL OR channel = ${channel})) AS present
    `);
    const reason = row.campaign_state !== 'ATIVA' ? 'CAMPAIGN_NOT_ACTIVE'
      : !['PENDENTE', 'ELEGIVEL', 'EM_ANDAMENTO'].includes(row.recipient_state) ? 'RECIPIENT_NOT_EXECUTABLE'
      : !['PENDENTE', 'APROVADA'].includes(row.attempt_state) ? 'ATTEMPT_NOT_EXECUTABLE'
      : row.is_blocked ? 'LEAD_BLOCKED'
      : row.do_not_contact ? 'DO_NOT_CONTACT'
      : row.crm_stage === 'NAO_CONTATAR' ? 'CRM_DO_NOT_CONTACT'
      : !row.has_valid_contact ? 'CONTACT_NOT_VALIDATED'
      : row.has_opt_out || optOutAfterLock[0]?.present ? 'OPT_OUT'
      : row.has_response ? 'ALREADY_RESPONDED'
      : null;
    if (reason) {
      await tx.execute(sql`UPDATE campaign_outbox SET claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL,
        claim_expires_at = NULL, status = 'BLOCKED' WHERE ${stalePredicate(claim, now)}`);
      return { decision: 'INELIGIBLE', channel, reason };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('campaign-channel:' || ${channel}))`);
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
    if (alreadyStarted[0]) {
      const retrySpacingAt = nextCampaignExecutionInstant(
        now,
        { startUtc: policy.windowStartUtc, endUtc: policy.windowEndUtc },
        policy.minSpacingMs,
        now,
      );
      await tx.execute(sql`INSERT INTO campaign_channel_runtime
        (channel, next_available_at, created_at, updated_at)
        VALUES (${channel}, ${retrySpacingAt.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        ON CONFLICT (channel) DO UPDATE SET next_available_at = EXCLUDED.next_available_at,
          updated_at = ${now.toISOString()}::timestamptz`);
      return {
        decision: 'STARTED', channel: alreadyStarted[0].channel, attemptId: alreadyStarted[0].attempt_id,
        executionId: alreadyStarted[0].id, startedAt: new Date(alreadyStarted[0].started_at),
      };
    }
    const quotaDay = now.toISOString().slice(0, 10);
    const limit = channel === 'EMAIL' ? policy.dailyLimitEmail : policy.dailyLimitWhatsapp;
    const quota = await tx.execute<{ count: number }>(sql`
      INSERT INTO campaign_daily_channel_counters (channel, quota_day, count, created_at, updated_at)
      VALUES (${channel}, ${quotaDay}::date, 0, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
      ON CONFLICT (channel, quota_day) DO UPDATE SET channel = EXCLUDED.channel
      RETURNING count
    `);
    if ((quota[0]?.count ?? 0) >= limit) {
      const nextDay = new Date(`${quotaDay}T00:00:00.000Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const nextWindow = nextCampaignExecutionInstant(nextDay, {
        startUtc: policy.windowStartUtc, endUtc: policy.windowEndUtc,
      }, 0, null);
      await rescheduleClaim(tx as unknown as Database, claim, nextWindow, now);
      return { decision: 'RESCHEDULED', channel, availableAt: nextWindow, reason: 'DAILY_LIMIT' };
    }
    await tx.execute(sql`UPDATE campaign_daily_channel_counters SET count = count + 1, updated_at = ${now.toISOString()}::timestamptz
      WHERE channel = ${channel} AND quota_day = ${quotaDay}::date`);
    const nextSpacingAt = nextCampaignExecutionInstant(
      now,
      { startUtc: policy.windowStartUtc, endUtc: policy.windowEndUtc },
      policy.minSpacingMs,
      now,
    );
    await tx.execute(sql`INSERT INTO campaign_channel_runtime
      (channel, next_available_at, created_at, updated_at)
      VALUES (${channel}, ${nextSpacingAt.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
      ON CONFLICT (channel) DO UPDATE SET next_available_at = EXCLUDED.next_available_at,
        updated_at = ${now.toISOString()}::timestamptz`);
    const starts = await tx.execute<{ id: string }>(sql`INSERT INTO campaign_execution_starts
      (outbox_id, attempt_id, channel, quota_day, started_at, claim_generation, cycle, created_at)
      VALUES (${claim.id}::uuid, ${row.attempt_id}::uuid, ${channel}, ${quotaDay}::date,
        ${now.toISOString()}::timestamptz, ${claim.generation}, ${claim.deadLetterCycle}, ${now.toISOString()}::timestamptz)
      RETURNING id`);
    return { decision: 'STARTED', channel, attemptId: row.attempt_id, executionId: starts[0]!.id, startedAt: now };
  });
}

async function rescheduleClaim(db: Database, claim: OutboxClaim, availableAt: Date, now: Date): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`UPDATE campaign_outbox SET available_at = ${availableAt.toISOString()}::timestamptz,
    attempts = greatest(attempts - 1, 0),
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE ${stalePredicate(claim, now)} RETURNING id`);
  return rows.length === 1;
}

export async function rescheduleCampaignOutbox(db: Database, claim: OutboxClaim, availableAt: Date, now = new Date()): Promise<boolean> {
  return rescheduleClaim(db, claim, availableAt, now);
}

export type SafeOutboxFailureCode = 'SIMULATED_TIMEOUT_BEFORE_CONFIRMATION' | 'SIMULATED_TIMEOUT_AFTER_CONFIRMATION' | 'SIMULATED_EXECUTION_FAILED' | 'FINAL_LEASE_EXPIRED';

export async function failCampaignOutbox(db: Database, claim: OutboxClaim, policy: CampaignExecutionPolicy, now = new Date(), errorCode: SafeOutboxFailureCode = 'SIMULATED_EXECUTION_FAILED'): Promise<'RETRY' | 'DEAD_LETTERED' | 'STALE'> {
  const exhausted = claim.attempt >= resolveOutboxMaxAttemptsSnapshot(claim.maxAttempts, policy.maxAttempts);
  const availableAt = deterministicRetryAt(now, claim.attempt, policy.retryBaseMs, policy.retryMaxMs);
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string; payload: unknown; attempts: number; dead_letter_cycle: number }>(sql`
      SELECT id, payload, attempts, dead_letter_cycle FROM campaign_outbox
      WHERE ${stalePredicate(claim, now)} FOR UPDATE`);
    const row = locked[0];
    if (!row) return 'STALE';
    if (exhausted) {
      await tx.execute(sql`INSERT INTO campaign_dead_letters
        (outbox_id, cycle, correlation_id, payload, error, error_code, attempts, claim_generation, created_at)
        VALUES (${claim.id}::uuid, ${row.dead_letter_cycle}, ${`outbox:${claim.id}:cycle:${row.dead_letter_cycle}`},
          ${JSON.stringify(row.payload)}::jsonb, ${errorCode}, ${errorCode}, ${row.attempts}, ${claim.generation}, ${now.toISOString()}::timestamptz)
        ON CONFLICT (outbox_id, cycle) DO NOTHING`);
    }
    const updated = await tx.execute<{ id: string }>(sql`UPDATE campaign_outbox SET
      status = ${exhausted ? 'EXHAUSTED' : 'PENDING'}, available_at = ${availableAt.toISOString()}::timestamptz,
      claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
      WHERE ${stalePredicate(claim, now)} RETURNING id`);
    return updated.length === 0 ? 'STALE' : exhausted ? 'DEAD_LETTERED' : 'RETRY';
  });
}

async function finalizeExpiredFinalAttempt(db: Database, maxAttempts: number, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.execute<{
      id: string; payload: unknown; attempts: number; claim_generation: number;
      dead_letter_cycle: number; confirmed: boolean; max_attempts: number;
    }>(sql`
      SELECT o.id, o.payload, o.attempts, o.claim_generation, o.dead_letter_cycle,
        COALESCE(o.max_attempts_snapshot, ${maxAttempts}) AS max_attempts,
        EXISTS (SELECT 1 FROM campaign_simulated_confirmations c
          WHERE c.outbox_id = o.id AND c.cycle = o.dead_letter_cycle) AS confirmed
      FROM campaign_outbox o
      WHERE o.status = 'PENDING' AND o.attempts >= COALESCE(o.max_attempts_snapshot, ${maxAttempts})
        AND o.claim_expires_at <= ${now.toISOString()}::timestamptz
      ORDER BY o.claim_expires_at, o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1`);
    const row = rows[0];
    if (!row) return;
    if (row.confirmed) {
      await tx.execute(sql`UPDATE campaign_outbox SET status = 'PUBLISHED',
        max_attempts_snapshot = COALESCE(max_attempts_snapshot, ${row.max_attempts}),
        published_at = ${now.toISOString()}::timestamptz, claim_worker_id = NULL,
        claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
        WHERE id = ${row.id}::uuid AND status = 'PENDING' AND attempts >= ${row.max_attempts}
          AND claim_expires_at <= ${now.toISOString()}::timestamptz`);
      return;
    }
    await tx.execute(sql`INSERT INTO campaign_dead_letters
      (outbox_id, cycle, correlation_id, payload, error, error_code, attempts, claim_generation, created_at)
      VALUES (${row.id}::uuid, ${row.dead_letter_cycle}, ${`outbox:${row.id}:cycle:${row.dead_letter_cycle}`},
        ${JSON.stringify(row.payload)}::jsonb, 'FINAL_LEASE_EXPIRED', 'FINAL_LEASE_EXPIRED',
        ${row.attempts}, ${row.claim_generation}, ${now.toISOString()}::timestamptz)
      ON CONFLICT (outbox_id, cycle) DO NOTHING`);
    await tx.execute(sql`UPDATE campaign_outbox SET status = 'EXHAUSTED',
      max_attempts_snapshot = COALESCE(max_attempts_snapshot, ${row.max_attempts}), claim_worker_id = NULL,
      claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL WHERE id = ${row.id}::uuid
      AND status = 'PENDING' AND attempts >= ${row.max_attempts}
        AND claim_expires_at <= ${now.toISOString()}::timestamptz`);
  });
}

export class SimulatedConfirmationError extends Error {
  constructor(readonly code: 'STALE' | 'IDENTITY_CONFLICT') { super(`SIMULATED_CONFIRMATION_${code}`); }
}

export async function confirmSimulatedCampaignExecution(db: Database, input: {
  executionId: string; outboxId: string; cycle: number; attemptId?: string; channel: string;
  workerId: string; token: string; generation: number; confirmedAt?: Date;
}): Promise<{ executionId: string; replayed: boolean }> {
  const confirmedAt = input.confirmedAt ?? new Date();
  return db.transaction(async (tx) => {
    const active = await tx.execute<{ id: string }>(sql`
      SELECT id FROM campaign_outbox
      WHERE id = ${input.outboxId}::uuid AND status = 'PENDING'
        AND claim_worker_id = ${input.workerId} AND claim_token = ${input.token}::uuid
        AND claim_generation = ${input.generation} AND dead_letter_cycle = ${input.cycle}
        AND claim_expires_at > ${confirmedAt.toISOString()}::timestamptz
      FOR UPDATE`);
    if (!active[0]) throw new SimulatedConfirmationError('STALE');
    const inserted = await tx.execute<{ execution_id: string }>(sql`
      INSERT INTO campaign_simulated_confirmations
        (execution_id, outbox_id, cycle, attempt_id, channel, confirmed_at, created_at)
      VALUES (${input.executionId}::uuid, ${input.outboxId}::uuid, ${input.cycle},
        ${input.attemptId ?? null}::uuid, ${input.channel},
        ${confirmedAt.toISOString()}::timestamptz, ${confirmedAt.toISOString()}::timestamptz)
      ON CONFLICT (outbox_id, cycle) DO NOTHING RETURNING execution_id`);
    if (inserted[0]) return { executionId: inserted[0].execution_id, replayed: false };
    const existing = await tx.execute<{ execution_id: string; attempt_id: string | null; channel: string }>(sql`
      SELECT execution_id, attempt_id, channel FROM campaign_simulated_confirmations
      WHERE outbox_id = ${input.outboxId}::uuid AND cycle = ${input.cycle}`);
    if (existing[0]?.execution_id !== input.executionId
      || existing[0].attempt_id !== (input.attemptId ?? null) || existing[0].channel !== input.channel) {
      throw new SimulatedConfirmationError('IDENTITY_CONFLICT');
    }
    return { executionId: existing[0].execution_id, replayed: true };
  });
}
export type CampaignDeadLetterRecoveryResult = { recoveryId: string; outboxId: string; fromCycle: number; toCycle: number; replayed: boolean };
export class CampaignRecoveryError extends Error {
  constructor(readonly code: 'IDEMPOTENCY_CONFLICT' | 'RECOVERY_REJECTED') { super(code); }
}

export function campaignRecoveryFingerprint(input: {
  deadLetterId?: string; outboxId?: string; actor: string; reason: string; availableAt: Date;
}): string {
  return createHash('sha256').update(JSON.stringify({
    deadLetterId: input.deadLetterId ?? null, outboxId: input.outboxId ?? null,
    actor: input.actor.trim(), reason: input.reason.trim(), availableAt: input.availableAt.toISOString(),
  })).digest('hex');
}

export async function recoverCampaignDeadLetter(db: Database, input: {
  deadLetterId?: string; outboxId?: string; actor: string; reason: string; idempotencyKey: string; now?: Date; availableAt?: Date;
  observe?: (event: 'campaign_dead_letter_recovery_requested' | 'campaign_dead_letter_recovery_completed' | 'campaign_dead_letter_recovery_rejected', metadata: Record<string, string | number | boolean>) => void;
}): Promise<CampaignDeadLetterRecoveryResult> {
  const now = input.now ?? new Date();
  const availableAt = input.availableAt ?? now;
  const actor = input.actor.trim(); const reason = input.reason.trim(); const key = input.idempotencyKey.trim();
  if ((!input.deadLetterId && !input.outboxId) || !actor || actor.length > 200 || !reason || reason.length > 1000 || !key || key.length > 200) {
    throw new CampaignRecoveryError('RECOVERY_REJECTED');
  }
  const identity = input.deadLetterId ? { deadLetterId: input.deadLetterId } : { outboxId: input.outboxId! };
  input.observe?.('campaign_dead_letter_recovery_requested', { ...identity, requestedAt: now.toISOString() });
  const fingerprint = campaignRecoveryFingerprint({
    ...(input.deadLetterId ? { deadLetterId: input.deadLetterId } : {}),
    ...(input.outboxId ? { outboxId: input.outboxId } : {}), actor, reason, availableAt,
  });
  try {
    const result = await db.transaction(async (tx) => {
    const replay = await tx.execute<{ id: string; outbox_id: string; from_cycle: number; to_cycle: number; payload_fingerprint: string }>(sql`
      SELECT id, outbox_id, from_cycle, to_cycle, payload_fingerprint FROM campaign_dead_letter_recoveries
      WHERE idempotency_key = ${key}`);
    if (replay[0]) {
      if (replay[0].payload_fingerprint !== fingerprint) throw new CampaignRecoveryError('IDEMPOTENCY_CONFLICT');
      return { recoveryId: replay[0].id, outboxId: replay[0].outbox_id, fromCycle: replay[0].from_cycle, toCycle: replay[0].to_cycle, replayed: true };
    }
    const resolved = await tx.execute<{ id: string; outbox_id: string; cycle: number }>(sql`
      SELECT dl.id, dl.outbox_id, dl.cycle FROM campaign_dead_letters dl
      WHERE (${input.deadLetterId ?? null}::uuid IS NULL OR dl.id = ${input.deadLetterId ?? null}::uuid)
        AND (${input.outboxId ?? null}::uuid IS NULL OR dl.outbox_id = ${input.outboxId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM campaign_dead_letter_recoveries r WHERE r.dead_letter_id = dl.id)
      ORDER BY dl.cycle DESC LIMIT 1`);
    if (!resolved[0]) throw new CampaignRecoveryError('RECOVERY_REJECTED');
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`campaign-outbox:${resolved[0].outbox_id}`}))`);
    const replayAfterLock = await tx.execute<{ id: string; outbox_id: string; from_cycle: number; to_cycle: number; payload_fingerprint: string }>(sql`
      SELECT id, outbox_id, from_cycle, to_cycle, payload_fingerprint FROM campaign_dead_letter_recoveries
      WHERE idempotency_key = ${key}`);
    if (replayAfterLock[0]) {
      if (replayAfterLock[0].payload_fingerprint !== fingerprint) throw new CampaignRecoveryError('IDEMPOTENCY_CONFLICT');
      return { recoveryId: replayAfterLock[0].id, outboxId: replayAfterLock[0].outbox_id,
        fromCycle: replayAfterLock[0].from_cycle, toCycle: replayAfterLock[0].to_cycle, replayed: true };
    }
    const locked = await tx.execute<{ status: string; dead_letter_cycle: number; claim_worker_id: string | null }>(sql`
      SELECT status, dead_letter_cycle, claim_worker_id FROM campaign_outbox
      WHERE id = ${resolved[0].outbox_id}::uuid FOR UPDATE`);
    if (!locked[0] || locked[0].status !== 'EXHAUSTED' || locked[0].claim_worker_id !== null || locked[0].dead_letter_cycle !== resolved[0].cycle) {
      throw new CampaignRecoveryError('RECOVERY_REJECTED');
    }
    const toCycle = resolved[0].cycle + 1;
    const inserted = await tx.execute<{ id: string }>(sql`INSERT INTO campaign_dead_letter_recoveries
      (dead_letter_id, outbox_id, from_cycle, to_cycle, actor, reason, idempotency_key, payload_fingerprint, available_at, recovered_at, created_at)
      VALUES (${resolved[0].id}::uuid, ${resolved[0].outbox_id}::uuid, ${resolved[0].cycle}, ${toCycle}, ${actor}, ${reason},
        ${key}, ${fingerprint}, ${availableAt.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
      RETURNING id`);
    await tx.execute(sql`UPDATE campaign_outbox SET status = 'PENDING', attempts = 0, available_at = ${availableAt.toISOString()}::timestamptz,
      dead_letter_cycle = ${toCycle}, max_attempts_snapshot = NULL, published_at = NULL,
      claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
      WHERE id = ${resolved[0].outbox_id}::uuid`);
    return { recoveryId: inserted[0]!.id, outboxId: resolved[0].outbox_id, fromCycle: resolved[0].cycle, toCycle, replayed: false };
    });
    input.observe?.('campaign_dead_letter_recovery_completed', {
      outboxId: result.outboxId, fromCycle: result.fromCycle, toCycle: result.toCycle,
      replayed: result.replayed, completedAt: now.toISOString(),
    });
    return result;
  } catch (error) {
    input.observe?.('campaign_dead_letter_recovery_rejected', {
      ...identity, decision: error instanceof CampaignRecoveryError ? error.code : 'RECOVERY_REJECTED',
      rejectedAt: now.toISOString(),
    });
    throw error;
  }
}

export async function completeCampaignOutbox(db: Database, claim: Pick<OutboxClaim, 'id' | 'workerId' | 'token' | 'generation'>, now = new Date()): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`UPDATE campaign_outbox SET status = 'PUBLISHED', published_at = ${now.toISOString()}::timestamptz,
    claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE ${stalePredicate(claim, now)} RETURNING id`);
  return rows.length === 1;
}
