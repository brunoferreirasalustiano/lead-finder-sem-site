import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import type { OverpassClient } from '@lead-finder/overpass-client';
import type { OperationalLogger } from './operational-observability.js';
import { createCollectionProcessor } from './collection-egress.js';

const db = {} as Database;

function createLogger() {
  return { info: vi.fn(), error: vi.fn() } satisfies OperationalLogger;
}

describe('collection egress', () => {
  it('stays inert and emits a safe stable event when disabled', async () => {
    const logger = createLogger();
    const createClient = vi.fn();
    const processJob = vi.fn();

    const processCollection = createCollectionProcessor(
      db,
      { enabled: false, endpoint: undefined, timeoutMs: 30_000, maxRetries: 3 },
      logger,
      createClient,
      processJob,
    );

    await expect(processCollection()).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith({
      correlationId: 'collection-egress',
      event: 'COLLECTION_EGRESS_DISABLED',
      outcome: 'INELIGIBLE',
      reason: 'UNKNOWN',
      durationMs: 0,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/https?:|overpass-api|endpoint/i);
  });

  it('rejects enabled egress without creating a client when the URL is absent', () => {
    const createClient = vi.fn();
    expect(() => createCollectionProcessor(
      db,
      { enabled: true, endpoint: undefined, timeoutMs: 30_000, maxRetries: 3 },
      createLogger(),
      createClient,
    )).toThrow('OVERPASS_API_URL is required when COLLECTION_EGRESS_ENABLED=true');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates the existing client and permits collection only when explicitly enabled', async () => {
    const client = {} as OverpassClient;
    const createClient = vi.fn(() => client);
    const processJob = vi.fn(() => Promise.resolve(true));
    const processCollection = createCollectionProcessor(
      db,
      {
        enabled: true,
        endpoint: 'https://overpass.example.test/api',
        timeoutMs: 5_000,
        maxRetries: 1,
      },
      createLogger(),
      createClient,
      processJob,
    );

    expect(createClient).toHaveBeenCalledWith({
      endpoint: 'https://overpass.example.test/api',
      timeoutMs: 5_000,
      maxRetries: 1,
    });
    await expect(processCollection()).resolves.toBe(true);
    expect(processJob).toHaveBeenCalledWith(db, client);
  });

  it('passes the bounded request identity to the claim processor', async () => {
    const client = {} as OverpassClient;
    const processJob = vi.fn(() => Promise.resolve(true));
    const processCollection = createCollectionProcessor(
      db,
      {
        enabled: true,
        endpoint: 'https://overpass.example.test/api',
        timeoutMs: 5_000,
        maxRetries: 1,
        requestIdentity: '2026-08-18|13|campinas-sp|daily6-v1',
      },
      createLogger(),
      () => client,
      processJob,
    );

    await expect(processCollection()).resolves.toBe(true);
    expect(processJob).toHaveBeenCalledWith(db, client, '2026-08-18|13|campinas-sp|daily6-v1');
  });
});
