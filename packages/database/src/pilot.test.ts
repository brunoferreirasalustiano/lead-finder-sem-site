import { describe, expect, it } from 'vitest';
import { PilotPersistenceError, pilotFingerprint } from './pilot.js';

describe('pilot persistence primitives', () => {
  it('uses a canonical payload fingerprint for idempotency', () => {
    expect(pilotFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(pilotFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
    expect(pilotFingerprint({ a: 1 })).not.toBe(pilotFingerprint({ a: 2 }));
  });
  it('exposes stable sanitized persistence error codes', () => {
    expect(new PilotPersistenceError('conflict', 'VERSION_CONFLICT')).toMatchObject({ name: 'PilotPersistenceError', code: 'VERSION_CONFLICT' });
  });
});
