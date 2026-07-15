import { sql } from 'drizzle-orm';
import type { Database } from './index.js';

export interface OperationalSnapshot {
  pendingCount: number; oldestPendingAgeMs: number; claimedCount: number; publishedCount: number;
  exhaustedCount: number; retryCount: number; staleAckCount: number; expiredLeaseCount: number;
  recoveredLeaseCount: number; deadLetterCount: number; throughputRecent: number; averageDurationMs: number;
  errorsByReason: Record<string, number>;
}

export interface ReadinessThresholds { backlogCount: number; oldestPendingAgeMs: number; }
export type ReadinessStatus = 'ready' | 'degraded' | 'unhealthy';

const number = (value: unknown) => Number(value ?? 0);
export async function getOperationalSnapshot(db: Database, now = new Date()): Promise<OperationalSnapshot> {
  const rows = await db.execute<{
    pending_count: unknown; oldest_pending_age_ms: unknown; claimed_count: unknown; published_count: unknown;
    exhausted_count: unknown; retry_count: unknown; expired_lease_count: unknown; recovered_lease_count: unknown;
    dead_letter_count: unknown; throughput_recent: unknown;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE status = 'PENDING') AS pending_count,
      COALESCE(extract(epoch FROM (${now.toISOString()}::timestamptz - min(available_at) FILTER (WHERE status = 'PENDING')) * 1000), 0) AS oldest_pending_age_ms,
      count(*) FILTER (WHERE status = 'PENDING' AND claim_expires_at > ${now.toISOString()}::timestamptz) AS claimed_count,
      count(*) FILTER (WHERE status = 'PUBLISHED') AS published_count,
      count(*) FILTER (WHERE status = 'EXHAUSTED') AS exhausted_count,
      COALESCE(sum(attempts) FILTER (WHERE status = 'PENDING'), 0) AS retry_count,
      count(*) FILTER (WHERE status = 'PENDING' AND claim_expires_at <= ${now.toISOString()}::timestamptz) AS expired_lease_count,
      (SELECT count(*) FROM campaign_dead_letter_recoveries) AS recovered_lease_count,
      (SELECT count(*) FROM campaign_dead_letters) AS dead_letter_count,
      count(*) FILTER (WHERE status = 'PUBLISHED' AND published_at >= ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz) AS throughput_recent
    FROM campaign_outbox
  `);
  const row = rows[0] as {
    pending_count: unknown; oldest_pending_age_ms: unknown; claimed_count: unknown; published_count: unknown;
    exhausted_count: unknown; retry_count: unknown; expired_lease_count: unknown; recovered_lease_count: unknown;
    dead_letter_count: unknown; throughput_recent: unknown;
  } | undefined;
  if (!row) throw new Error('OPERATIONAL_SNAPSHOT_EMPTY');
  return { pendingCount: number(row.pending_count), oldestPendingAgeMs: Math.max(0, Math.round(number(row.oldest_pending_age_ms))),
    claimedCount: number(row.claimed_count), publishedCount: number(row.published_count), exhaustedCount: number(row.exhausted_count),
    retryCount: number(row.retry_count), staleAckCount: 0, expiredLeaseCount: number(row.expired_lease_count),
    recoveredLeaseCount: number(row.recovered_lease_count), deadLetterCount: number(row.dead_letter_count), throughputRecent: number(row.throughput_recent),
    averageDurationMs: 0, errorsByReason: {} };
}

export async function verifyMigrationsCompatible(db: Database): Promise<void> {
  const rows = await db.execute<{ missing: number }>(sql`
    SELECT count(*)::int AS missing FROM (VALUES
      ('0001_initial'), ('0010_campaign_outbox_max_attempts_snapshot')
    ) AS required(version) WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = required.version)
  `);
  if ((rows[0]?.missing ?? 0) !== 0) throw new Error('MIGRATIONS_INCOMPATIBLE');
}

export async function getReadiness(db: Database, thresholds: ReadinessThresholds, now = new Date()) {
  try {
    await verifyMigrationsCompatible(db); const snapshot = await getOperationalSnapshot(db, now);
    const degraded = snapshot.pendingCount >= thresholds.backlogCount || snapshot.oldestPendingAgeMs >= thresholds.oldestPendingAgeMs;
    return { status: degraded ? 'degraded' : 'ready' as ReadinessStatus, snapshot };
  } catch { return { status: 'unhealthy' as ReadinessStatus, snapshot: null }; }
}
