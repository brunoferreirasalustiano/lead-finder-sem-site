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

  it('fails closed for an authenticated request when API batch processing is disabled', async () => {
    const app = buildApp(db, { internalCronSecret: secret });
    const response = await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable', code: 'BATCH_DISABLED' });
    await app.close();
  });

  it('executes one bounded batch and rejects persistent replay', async () => {
    const beginBatchInvocation = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const processLeadBatch = vi.fn(() => Promise.resolve({ executionSource: 'supabase-render' as const,
      outcome: 'COMPLETED' as const, attempted: 5, processed: 3, durationMs: 12 }));
    const completeBatchInvocation = vi.fn(() => Promise.resolve());
    const app = buildApp(db, { internalCronSecret: secret, processLeadBatch, beginBatchInvocation,
      completeBatchInvocation });
    const first = await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ executionSource: 'supabase-render', outcome: 'COMPLETED',
      attempted: 5, processed: 3, durationMs: 12 });
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers })).statusCode).toBe(409);
    expect(processLeadBatch).toHaveBeenCalledTimes(1);
    expect(completeBatchInvocation).toHaveBeenCalledWith(headers['idempotency-key']);
    await app.close();
  });

  it('releases a failed invocation so the same key can be retried', async () => {
    const abandonBatchInvocation = vi.fn(() => Promise.resolve());
    const app = buildApp(db, { internalCronSecret: secret,
      processLeadBatch: () => Promise.reject(new Error('synthetic failure')),
      beginBatchInvocation: () => Promise.resolve(true), abandonBatchInvocation });
    expect((await app.inject({ method: 'POST', url: '/internal/jobs/process-lead-batch', headers })).statusCode).toBe(500);
    expect(abandonBatchInvocation).toHaveBeenCalledWith(headers['idempotency-key']);
    await app.close();
  });

  it('answers an allowlisted authenticated CORS preflight without authentication', async () => {
    const app = buildApp(db, { corsAllowedOrigins: ['https://app.example.test'] });
    const response = await app.inject({ method: 'OPTIONS', url: '/leads', headers: {
      origin: 'https://app.example.test', 'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    await app.close();
  });
});
