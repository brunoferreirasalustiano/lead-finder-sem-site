import { describe, expect, it } from 'vitest';
import {
  canTransitionQualification,
  isEligibleForOutreach,
  normalizeAddress,
  normalizeBrazilianPhone,
  normalizeBusinessName,
  normalizeEmail,
} from './qualification.js';

describe('qualification domain', () => {
  it('normalizes Brazilian contacts and identity fields', () => {
    expect(normalizeBrazilianPhone('(11) 99999-1234')).toBe('+5511999991234');
    expect(normalizeBrazilianPhone('123')).toBeNull();
    expect(normalizeEmail(' COMERCIAL@Exemplo.COM ')).toBe('comercial@exemplo.com');
    expect(normalizeEmail('invalid')).toBeNull();
    expect(normalizeBusinessName('Oficina São José LTDA')).toBe('oficina sao jose');
    expect(normalizeAddress('Rua São João, 10')).toBe('rua sao joao 10');
  });
  it('allows only explicit transitions', () => {
    expect(canTransitionQualification('PENDENTE', 'VALIDANDO')).toBe(true);
    expect(canTransitionQualification('PENDENTE', 'SEM_SITE_CONFIRMADO')).toBe(false);
    expect(canTransitionQualification('DESCARTADO', 'VALIDANDO')).toBe(false);
  });
  it('blocks outreach unless confirmed with a verified contact', () => {
    const base = {
      qualificationStatus: 'SEM_SITE_CONFIRMADO' as const,
      isBlocked: false,
      doNotContact: false,
      contacts: [{ isValid: true, verifiedAt: new Date() }],
    };
    expect(isEligibleForOutreach(base)).toBe(true);
    expect(isEligibleForOutreach({ ...base, qualificationStatus: 'VALIDANDO' })).toBe(false);
    expect(isEligibleForOutreach({ ...base, contacts: [] })).toBe(false);
    expect(isEligibleForOutreach({ ...base, doNotContact: true })).toBe(false);
  });
});
