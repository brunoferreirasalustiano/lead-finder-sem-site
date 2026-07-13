import { describe, expect, it } from 'vitest';
import { CampaignPersistenceError, persistenceFingerprint } from './campaign.js';

describe('campaign persistence primitives', () => {
  it('creates deterministic fingerprints independent of object key order', () => {
    expect(persistenceFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      persistenceFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(persistenceFingerprint({ value: 'a' })).not.toBe(persistenceFingerprint({ value: 'b' }));
  });

  it('exposes deterministic persistence conflict codes', () => {
    const error = new CampaignPersistenceError('stale', 'VERSION_CONFLICT');
    expect(error).toMatchObject({ name: 'CampaignPersistenceError', code: 'VERSION_CONFLICT', message: 'stale' });
  });
});
