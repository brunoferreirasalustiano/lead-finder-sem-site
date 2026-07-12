import { describe, expect, it } from 'vitest';
import { CrmDomainError } from '@lead-finder/shared';
import { hasPostgresCode, normalizeListOptions, type MutationResult } from './crm.js';

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
});
