import { describe, expect, it } from 'vitest';
import { outboxLeaseExpiration } from './campaign-outbox.js';

describe('outbox lease validation', () => {
  it('uses an injected clock deterministically', () => {
    expect(outboxLeaseExpiration(new Date('2026-07-13T12:00:00Z'), 5_000).toISOString())
      .toBe('2026-07-13T12:00:05.000Z');
  });

  it.each([0, 999, 3_600_001, 1.5])('rejects an unsafe lease duration: %s', (leaseMs) => {
    expect(() => outboxLeaseExpiration(new Date(), leaseMs)).toThrow(RangeError);
  });
});
