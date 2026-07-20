import { describe, expect, it, vi } from 'vitest';
import { processLeadBatch } from './index.js';

const db = {} as Parameters<typeof processLeadBatch>[0]['db'];
const leadership = vi.fn(() => Promise.resolve({ acquired: true, token: 'synthetic', generation: 1 }));
const renewal = vi.fn(() => Promise.resolve(true));

describe('processLeadBatch', () => {
  it('bounds a batch and returns sanitized aggregate metrics', async () => {
    const processOne = vi.fn(() => Promise.resolve(true));
    const report = await processLeadBatch({ db, batchSize: 5, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'supabase-render', executorId: 'render:test', processorRole: 'primary',
      leadershipLeaseMs: 60_000, processOne, acquireLeadership: leadership, renewLeadership: renewal });
    expect(report).toMatchObject({ outcome: 'COMPLETED', attempted: 5, processed: 5,
      executionSource: 'supabase-render' });
    expect(processOne).toHaveBeenCalledTimes(5);
  });

  it('does no work in standby or when another source holds leadership', async () => {
    const processOne = vi.fn(() => Promise.resolve(true));
    expect((await processLeadBatch({ db, batchSize: 5, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'oracle-vps', executorId: 'vps:test', processorRole: 'standby',
      leadershipLeaseMs: 60_000, processOne })).outcome).toBe('STANDBY');
    expect((await processLeadBatch({ db, batchSize: 5, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'supabase-render', executorId: 'render:test', processorRole: 'primary',
      leadershipLeaseMs: 60_000, processOne, acquireLeadership: () => Promise.resolve({ acquired: false }) })).outcome).toBe('STANDBY');
    expect(processOne).not.toHaveBeenCalled();
  });

  it('stops when the queue is empty', async () => {
    const processOne = vi.fn(() => Promise.resolve(false));
    const report = await processLeadBatch({ db, batchSize: 10, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'oracle-vps', executorId: 'vps:test', processorRole: 'primary',
      leadershipLeaseMs: 60_000, processOne, acquireLeadership: leadership, renewLeadership: renewal });
    expect(report).toMatchObject({ attempted: 1, processed: 0 });
  });

  it('stops before processing when its leadership generation is no longer current', async () => {
    const processOne = vi.fn(() => Promise.resolve(true));
    const report = await processLeadBatch({ db, batchSize: 5, timeBudgetMs: 45_000, dailyLimit: 60,
      dryRun: true, executionSource: 'supabase-render', executorId: 'render:test', processorRole: 'primary',
      leadershipLeaseMs: 60_000, processOne, acquireLeadership: leadership,
      renewLeadership: () => Promise.resolve(false) });
    expect(report).toMatchObject({ attempted: 0, processed: 0 });
    expect(processOne).not.toHaveBeenCalled();
  });
});
