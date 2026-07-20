import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp } from './app.js';

const db = {} as Database;
const secret = 'synthetic-internal-cron-secret-0001';
const headers = { authorization: `Bearer ${secret}`, 'x-cron-audience': 'lead-finder-batch',
  'idempotency-key': 'synthetic_batch_0001' };

describe('internal batch endpoint', () => {
  it('rejects anonymous and invalid authentication without executing', async () => {
    const processLeadBatch = vi.fn();
    const app = buildApp(db, { internalCronSecret: secret, processLeadBatch,
      beginBatchInvocation: () => Promise.resolve(true) });
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch',
      headers: { ...headers, authorization: 'Bearer wrong-secret-that-is-long-enough' } })).statusCode).toBe(401);
    expect(processLeadBatch).not.toHaveBeenCalled();
    await app.close();
  });

  it('executes one bounded batch and rejects persistent replay', async () => {
    const beginBatchInvocation = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const processLeadBatch = vi.fn(() => Promise.resolve({ executionSource: 'supabase-render' as const,
      outcome: 'COMPLETED' as const, attempted: 5, processed: 3, durationMs: 12 }));
    const app = buildApp(db, { internalCronSecret: secret, processLeadBatch, beginBatchInvocation });
    const first = await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ executionSource: 'supabase-render', outcome: 'COMPLETED',
      attempted: 5, processed: 3, durationMs: 12 });
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers })).statusCode).toBe(409);
    expect(processLeadBatch).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
