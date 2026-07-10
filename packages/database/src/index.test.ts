import { describe, expect, it } from 'vitest';
import { uniqueByOsm } from './index.js';
describe('uniqueByOsm', () =>
  it('deduplicates by composite OSM identity', () =>
    expect(
      uniqueByOsm([
        { osmType: 'node' as const, osmId: '1' },
        { osmType: 'node' as const, osmId: '1' },
        { osmType: 'way' as const, osmId: '1' },
      ]),
    ).toHaveLength(2)));
