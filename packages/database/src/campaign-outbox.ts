import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export interface OutboxClaim {
  id: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  workerId: string;
  token: string;
  generation: number;
  expiresAt: Date;
}

export interface ClaimOutboxInput {
  workerId: string;
  leaseMs: number;
  now?: Date;
  token?: string;
}

export function outboxLeaseExpiration(now: Date, leaseMs: number): Date {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) {
    throw new RangeError('leaseMs must be an integer between 1000 and 3600000');
  }
  return new Date(now.getTime() + leaseMs);
}

const validWorkerId = (workerId: string) => {
  const normalized = workerId.trim();
  if (!normalized || normalized.length > 200) throw new RangeError('workerId must contain 1 to 200 characters');
  return normalized;
};

export async function claimCampaignOutbox(db: Database, input: ClaimOutboxInput): Promise<OutboxClaim | null> {
  const workerId = validWorkerId(input.workerId);
  const now = input.now ?? new Date();
  const expiresAt = outboxLeaseExpiration(now, input.leaseMs);
  const token = input.token ?? randomUUID();
  const rows = await db.execute<{
    id: string; event_type: string; payload: unknown; idempotency_key: string;
    claim_generation: number; claim_expires_at: Date;
  }>(sql`
    WITH candidate AS (
      SELECT id
      FROM campaign_outbox
      WHERE status = 'PENDING'
        AND available_at <= ${now}
        AND (claim_expires_at IS NULL OR claim_expires_at <= ${now})
      ORDER BY available_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE campaign_outbox AS outbox
    SET claim_worker_id = ${workerId},
        claim_token = ${token}::uuid,
        claim_generation = outbox.claim_generation + 1,
        claimed_at = ${now},
        claim_expires_at = ${expiresAt},
        attempts = outbox.attempts + 1
    FROM candidate
    WHERE outbox.id = candidate.id
    RETURNING outbox.id, outbox.event_type, outbox.payload, outbox.idempotency_key,
              outbox.claim_generation, outbox.claim_expires_at
  `);
  const row = rows[0];
  return row ? {
    id: row.id, eventType: row.event_type, payload: row.payload, idempotencyKey: row.idempotency_key,
    workerId, token, generation: row.claim_generation, expiresAt: row.claim_expires_at,
  } : null;
}

export async function completeCampaignOutbox(
  db: Database,
  claim: Pick<OutboxClaim, 'id' | 'workerId' | 'token' | 'generation'>,
  now = new Date(),
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE campaign_outbox
    SET status = 'PUBLISHED', published_at = ${now},
        claim_worker_id = NULL, claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
    WHERE id = ${claim.id}::uuid
      AND status = 'PENDING'
      AND claim_worker_id = ${claim.workerId}
      AND claim_token = ${claim.token}::uuid
      AND claim_generation = ${claim.generation}
      AND claim_expires_at > ${now}
    RETURNING id
  `);
  return rows.length === 1;
}
