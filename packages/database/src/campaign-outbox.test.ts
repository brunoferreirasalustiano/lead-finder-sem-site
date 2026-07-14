import { describe, expect, it, vi } from 'vitest';
import { campaignRecoveryFingerprint, CampaignRecoveryError, outboxLeaseExpiration, recoverCampaignDeadLetter } from './campaign-outbox.js';
import type { Database } from './index.js';

describe('outbox lease validation', () => {
  it('uses an injected clock deterministically', () => {
    expect(outboxLeaseExpiration(new Date('2026-07-13T12:00:00Z'), 5_000).toISOString())
      .toBe('2026-07-13T12:00:05.000Z');
  });

  it.each([0, 999, 3_600_001, 1.5])('rejects an unsafe lease duration: %s', (leaseMs) => {
    expect(() => outboxLeaseExpiration(new Date(), leaseMs)).toThrow(RangeError);
  });
});

describe('dead-letter recovery idempotency', () => {
  const availableAt = new Date('2030-01-01T12:00:00.000Z');
  const input = {
    deadLetterId: '00000000-0000-4000-8000-000000000001', actor: 'operator', reason: 'audited retry',
    idempotencyKey: 'recovery-key', now: availableAt, availableAt,
  };

  const databaseReturning = (payloadFingerprint: string) => {
    const execute = vi.fn().mockResolvedValueOnce([{
      id: '00000000-0000-4000-8000-000000000002', outbox_id: '00000000-0000-4000-8000-000000000003',
      from_cycle: 0, to_cycle: 1, payload_fingerprint: payloadFingerprint,
    }]);
    return { transaction: vi.fn((callback: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      callback({ execute })) } as unknown as Database;
  };

  it('replays the same key and payload', async () => {
    const fingerprint = campaignRecoveryFingerprint(input);
    await expect(recoverCampaignDeadLetter(databaseReturning(fingerprint), input)).resolves.toMatchObject({
      replayed: true, fromCycle: 0, toCycle: 1,
    });
  });

  it('rejects reuse of the key with a divergent payload', async () => {
    const db = databaseReturning('f'.repeat(64));
    await expect(recoverCampaignDeadLetter(db, input)).rejects.toEqual(
      new CampaignRecoveryError('IDEMPOTENCY_CONFLICT'),
    );
  });
});
