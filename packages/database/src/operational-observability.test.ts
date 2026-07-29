import { describe, expect, it, vi } from 'vitest';
import type { Database } from './index.js';
import { canReadOperationalSnapshot, getOperationalSnapshot, getReadiness } from './operational-observability.js';

const aggregate = { pending_count: 104, due_pending_count: 4, scheduled_pending_count: 100, oldest_pending_age_ms: 301000, claimed_count: 1, published_count: 8, exhausted_count: 2, retry_count: 3, expired_lease_count: 1, recovered_lease_count: 2, dead_letter_count: 2, throughput_recent: 5 };
describe('operational snapshot', () => {
  it('returns stable, low-cardinality database state and restart-safe fields', async () => {
    const execute = vi.fn().mockResolvedValue([aggregate]); const db = { execute } as unknown as Database;
    await expect(getOperationalSnapshot(db, new Date('2030-01-01T00:00:00.000Z'))).resolves.toEqual({ pendingCount: 104, duePendingCount: 4, scheduledPendingCount: 100, oldestPendingAgeMs: 301000, claimedCount: 1, publishedCount: 8, exhaustedCount: 2, retryCount: 3, staleAckCount: 0, expiredLeaseCount: 1, recoveredLeaseCount: 2, deadLetterCount: 2, throughputRecent: 5, averageDurationMs: 0, errorsByReason: {} });
  });
  it('detects whether the current role may read all operational tables', async () => {
    const allowed = { execute: vi.fn().mockResolvedValue([{ allowed: true }]) } as unknown as Database;
    await expect(canReadOperationalSnapshot(allowed)).resolves.toBe(true);
    const denied = { execute: vi.fn().mockResolvedValue([{ allowed: false }]) } as unknown as Database;
    await expect(canReadOperationalSnapshot(denied)).resolves.toBe(false);
  });
  it('distinguishes ready, degraded, and unhealthy without exposing database errors', async () => {
    const healthy = { execute: vi.fn().mockResolvedValueOnce([{ missing: 0 }]).mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([aggregate]) } as unknown as Database;
    await expect(getReadiness(healthy, { backlogCount: 10, oldestPendingAgeMs: 400000 })).resolves.toMatchObject({ status: 'ready', mode: 'operational' });
    const degraded = { execute: vi.fn().mockResolvedValueOnce([{ missing: 0 }]).mockResolvedValueOnce([{ allowed: true }]).mockResolvedValueOnce([aggregate]) } as unknown as Database;
    await expect(getReadiness(degraded, { backlogCount: 2, oldestPendingAgeMs: 400000 })).resolves.toMatchObject({ status: 'degraded', mode: 'operational' });
    const unhealthy = { execute: vi.fn().mockRejectedValue(new Error('connection refused')) } as unknown as Database;
    await expect(getReadiness(unhealthy, { backlogCount: 2, oldestPendingAgeMs: 400000 })).resolves.toEqual({ status: 'unhealthy', mode: 'restricted', snapshot: null });
  });
  it('uses restricted readiness without querying the operational snapshot', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ missing: 0 }]).mockResolvedValueOnce([{ allowed: false }]);
    const db = { execute } as unknown as Database;
    await expect(getReadiness(db, { backlogCount: 1, oldestPendingAgeMs: 1 })).resolves.toEqual({ status: 'ready', mode: 'restricted', snapshot: null });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('marks missing migration compatibility as unhealthy', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ missing: 1 }]) } as unknown as Database;
    await expect(getReadiness(db, { backlogCount: 1, oldestPendingAgeMs: 1 })).resolves.toEqual({ status: 'unhealthy', mode: 'restricted', snapshot: null });
  });
});
