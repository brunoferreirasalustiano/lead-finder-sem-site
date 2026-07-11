import { describe, expect, it } from 'vitest';
import { CrmDomainError } from '@lead-finder/shared';
import { hasPostgresCode } from './crm.js';

describe('CRM database error handling', () => {
  it('recognizes wrapped PostgreSQL uniqueness errors', () => {
    expect(hasPostgresCode(new Error('wrapped', { cause: { cause: { code: '23505' } } }), '23505')).toBe(true);
    expect(hasPostgresCode({ code: '40001' }, '23505')).toBe(false);
  });

  it('keeps deterministic domain conflict codes', () => {
    const error = new CrmDomainError('conflict', 'VERSION_CONFLICT');
    expect(error).toMatchObject({ name: 'CrmDomainError', code: 'VERSION_CONFLICT', message: 'conflict' });
  });
});
