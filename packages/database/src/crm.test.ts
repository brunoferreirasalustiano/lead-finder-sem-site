import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CrmDomainError } from '@lead-finder/shared';
import { hasPostgresCode, matchesReplayFingerprint, normalizeListOptions, type MutationResult } from './crm.js';

describe('CRM database error handling', () => {
  it('recognizes wrapped PostgreSQL uniqueness errors', () => {
    expect(hasPostgresCode(new Error('wrapped', { cause: { cause: { code: '23505' } } }), '23505')).toBe(true);
    expect(hasPostgresCode({ code: '40001' }, '23505')).toBe(false);
  });

  it('keeps deterministic domain conflict codes', () => {
    const error = new CrmDomainError('conflict', 'VERSION_CONFLICT');
    expect(error).toMatchObject({ name: 'CrmDomainError', code: 'VERSION_CONFLICT', message: 'conflict' });
  });

  it('bounds list pagination and exposes typed replay metadata', () => {
    expect(normalizeListOptions()).toEqual({ limit: 20, offset: 0 });
    expect(normalizeListOptions({ limit: 999, offset: -2 })).toEqual({ limit: 100, offset: 0 });
    expect(normalizeListOptions({ limit: Number.NaN, offset: Number.NaN })).toEqual({ limit: 20, offset: 0 });
    const result: MutationResult<{ id: string }> = { data: { id: 'resource' }, replayed: true };
    expect(result).toEqual({ data: { id: 'resource' }, replayed: true });
  });

  it('accepts only exact current or explicitly supplied legacy fingerprints', () => {
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const current = { stage: 'EM_VALIDACAO', expectedVersion: 1, principalId: 'operator' };
    const legacy = { actor: 'operator', idempotencyKey: 'stage-key', expectedVersion: 1, stage: 'EM_VALIDACAO' };
    expect(matchesReplayFingerprint(hash(current), current, legacy)).toBe(true);
    expect(matchesReplayFingerprint(hash(legacy), current, legacy)).toBe(true);
    for (const divergent of [
      { ...legacy, actor: 'other' },
      { ...legacy, stage: 'NAO_CONTATAR' },
      { ...legacy, expectedVersion: 2 },
      { ...legacy, reason: 'different' },
      { ...legacy, action: 'REOPEN' },
      { ...legacy, auditMetadata: { source: 'different' } },
      { ...legacy, extra: true },
    ]) expect(matchesReplayFingerprint(hash(divergent), current, legacy)).toBe(false);
    expect(matchesReplayFingerprint('invalid', current, legacy)).toBe(false);
    expect(matchesReplayFingerprint(hash(legacy), current)).toBe(false);
  });
});
