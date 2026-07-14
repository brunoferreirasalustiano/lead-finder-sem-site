import { describe, expect, it } from 'vitest';
import {
  assertUtcExecutionWindow,
  canRetryAttempt,
  deterministicRetryDelayMs,
  nextCampaignExecutionInstant,
  nextUtcWindowInstant,
  utcMinuteOfDay,
} from './campaign-execution.js';

const window = { startUtc: '08:00', endUtc: '18:00' };

describe('UTC campaign execution window', () => {
  it('uses a half-open interval at exact boundaries', () => {
    expect(nextUtcWindowInstant(new Date('2026-07-13T08:00:00.000Z'), window).toISOString())
      .toBe('2026-07-13T08:00:00.000Z');
    expect(nextUtcWindowInstant(new Date('2026-07-13T17:59:59.999Z'), window).toISOString())
      .toBe('2026-07-13T17:59:59.999Z');
    expect(nextUtcWindowInstant(new Date('2026-07-13T18:00:00.000Z'), window).toISOString())
      .toBe('2026-07-14T08:00:00.000Z');
  });

  it('moves pre-window and post-window instants to the deterministic next start', () => {
    expect(nextUtcWindowInstant(new Date('2026-07-13T07:59:59.999Z'), window).toISOString())
      .toBe('2026-07-13T08:00:00.000Z');
    expect(nextUtcWindowInstant(new Date('2026-12-31T23:59:59.999Z'), window).toISOString())
      .toBe('2027-01-01T08:00:00.000Z');
  });

  it('normalizes spacing that crosses the window end', () => {
    expect(nextCampaignExecutionInstant(
      new Date('2026-07-13T17:59:59.900Z'), window, 200,
      new Date('2026-07-13T17:59:59.800Z'),
    ).toISOString()).toBe('2026-07-14T08:00:00.000Z');
  });

  it('rejects malformed, empty, and overnight windows', () => {
    expect(() => utcMinuteOfDay('8:00')).toThrow();
    expect(() => assertUtcExecutionWindow({ startUtc: '08:00', endUtc: '08:00' })).toThrow();
    expect(() => assertUtcExecutionWindow({ startUtc: '18:00', endUtc: '08:00' })).toThrow();
  });
});

describe('deterministic retry policy', () => {
  it('uses exponential backoff without jitter and caps it', () => {
    expect([1, 2, 3, 4, 50].map((attempt) => deterministicRetryDelayMs(attempt, 1_000, 5_000)))
      .toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('does not overflow for very large attempts', () => {
    expect(deterministicRetryDelayMs(Number.MAX_SAFE_INTEGER, 1, 60_000)).toBe(60_000);
  });

  it('allows attempts only below the configured maximum', () => {
    expect(canRetryAttempt(4, 5)).toBe(true);
    expect(canRetryAttempt(5, 5)).toBe(false);
  });
});
