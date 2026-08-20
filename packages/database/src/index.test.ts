import { describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { claimCollection, createDatabase, enqueueCollection, uniqueByOsm } from './index.js';
import type { Database } from './index.js';

vi.mock('postgres', () => ({ default: vi.fn() }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: vi.fn((client: unknown) => ({ client })) }));
describe('uniqueByOsm', () =>
  it('deduplicates by composite OSM identity', () =>
    expect(
      uniqueByOsm([
        { osmType: 'node' as const, osmId: '1' },
        { osmType: 'node' as const, osmId: '1' },
        { osmType: 'way' as const, osmId: '1' },
      ]),
    ).toHaveLength(2)));

describe('collection persistence authorization', () => {
  it('rejects a direct enqueue without trusted egress authorization before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; } });
    await expect(enqueueCollection(db, { city: 'Synthetic' })).rejects.toThrow('COLLECTION_EGRESS_DISABLED');
    expect(databaseAccesses).toBe(0);
  });

  it('uses the internal atomic enqueue function and preserves its public result contract', async () => {
    const db = {
      execute: () => Promise.resolve([{ id: 'synthetic-job', status: 'PENDING', replayed: false }]),
    } as unknown as Database;
    await expect(enqueueCollection(
      db,
      { city: 'Campinas', state: 'SP', country: 'Brasil', category: 'oficinas', limit: 5 },
      { enabled: true, configurationVersion: 1 },
      '2026-08-12|09|campinas-sp|daily6-v1',
    )).resolves.toEqual({ id: 'synthetic-job', status: 'PENDING', replayed: false });
  });
});

describe('collection terminal reconciliation boundary', () => {
  it('keeps lease-expiry terminalization in the same transaction as Daily-6 sync', () => {
    const source = String(claimCollection);
    expect(source).toContain('expiredTerminalJobs');
    expect(source).toMatch(/expiredJob\.status === ["']FAILED["']/u);
    expect(source).toContain('sync_daily6_batch_from_collection');
  });
});

describe('database connection bounds', () => {
  it('allows the API to use a short connection timeout without changing the worker default', async () => {
    const client = { end: vi.fn() };
    vi.mocked(postgres).mockReturnValue(client as never);

    const apiDatabase = createDatabase('postgres://example', { connectTimeoutSeconds: 3 });
    const workerDatabase = createDatabase('postgres://example');

    expect(vi.mocked(postgres)).toHaveBeenNthCalledWith(1, 'postgres://example', expect.objectContaining({
      connect_timeout: 3,
    }));
    expect(vi.mocked(postgres)).toHaveBeenNthCalledWith(2, 'postgres://example', expect.objectContaining({
      connect_timeout: 10,
    }));
    await apiDatabase.close();
    await workerDatabase.close();
  });
});
