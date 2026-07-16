import { describe, expect, it } from 'vitest';
import { enqueueCollection, uniqueByOsm } from './index.js';
import type { Database } from './index.js';
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
});
