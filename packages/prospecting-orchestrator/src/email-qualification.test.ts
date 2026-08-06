import { describe, expect, it, vi } from 'vitest';
import {
  classifyTechnicalEmail,
  evaluateTechnicalEmail,
  inspectEmailSyntax,
  type EmailDomainResolver,
  type TechnicalEmailEvaluationInput,
} from './email-qualification.js';
import { evaluateLeadQualification, type LeadQualificationEvidence } from './lead-quality.js';

const email = 'comercial@Oficina-Exemplo.com.br';
const suppression = {
  hardBounce: false,
  optOut: false,
  complaint: false,
  doNotContact: false,
  naoContatar: false,
  blocked: false,
};
const validInput: TechnicalEmailEvaluationInput = {
  email,
  publicBusinessProvenance: 'CONFIRMED',
  suppression,
  domainResolution: { domainExists: 'YES', mx: 'PRESENT' },
};
const completeEvidence: LeadQualificationEvidence = {
  apparentActivity: true,
  noOfficialDomain: true,
  publicBusinessEmail: true,
  noPreviousContact: true,
  noSuppressionOrBounce: true,
};

const resolverFor = (resolution: unknown): { resolver: EmailDomainResolver; resolve: ReturnType<typeof vi.fn> } => {
  const resolve = vi.fn(() => Promise.resolve(resolution));
  return { resolver: { resolve }, resolve };
};

describe('technical email qualification', () => {
  it('rejects malformed syntax without returning the complete address', () => {
    const result = classifyTechnicalEmail({ ...validInput, email: 'not-an-address' });
    expect(result.state).toBe('INVALID');
    expect(result.reason).toBe('INVALID_SYNTAX');
    expect(result.domain).toBeNull();
    expect(JSON.stringify(result)).not.toContain('not-an-address');
  });

  it('normalizes the domain before resolution', async () => {
    const { resolver, resolve } = resolverFor({ domainExists: 'YES', mx: 'PRESENT' });
    const result = await evaluateTechnicalEmail(validInput, resolver);
    expect(result.state).toBe('VALID');
    expect(result.domain).toBe('oficina-exemplo.com.br');
    expect(resolve).toHaveBeenCalledWith('oficina-exemplo.com.br', { timeoutMs: 2000 });
  });

  it('accepts IDN domains after deterministic ASCII normalization', () => {
    expect(inspectEmailSyntax('contato@exämple.com')).toMatchObject({ valid: true, domain: 'xn--exmple-cua.com' });
  });

  it.each([
    [{ domainExists: 'NO', mx: 'UNKNOWN' }, 'DOMAIN_NOT_FOUND'],
    [{ domainExists: 'YES', mx: 'ABSENT' }, 'MX_NOT_FOUND'],
  ] as const)('classifies deterministic infrastructure failure as INVALID: %s', (domainResolution, reason) => {
    const result = classifyTechnicalEmail({ ...validInput, domainResolution });
    expect(result.state).toBe('INVALID');
    expect(result.reason).toBe(reason);
  });

  it('does not treat MX alone as proof of a business email', () => {
    const result = classifyTechnicalEmail({ ...validInput, publicBusinessProvenance: 'NOT_CONFIRMED' });
    expect(result.state).toBe('UNCERTAIN');
    expect(result.reason).toBe('PUBLIC_BUSINESS_PROVENANCE_UNCERTAIN');
  });

  it.each([
    ['hard bounce', { hardBounce: true }, 'HARD_BOUNCE'],
    ['opt out', { optOut: true }, 'OPT_OUT'],
    ['complaint', { complaint: true }, 'COMPLAINT'],
    ['do not contact', { doNotContact: true }, 'DO_NOT_CONTACT'],
    ['NAO_CONTATAR', { naoContatar: true }, 'NAO_CONTATAR'],
    ['operational block', { blocked: true }, 'BLOCKED'],
  ] as const)('gives %s precedence over technical evidence', (_label, signal, reason) => {
    const result = classifyTechnicalEmail({
      ...validInput,
      domainResolution: { domainExists: 'NO', mx: 'ABSENT' },
      suppression: { ...suppression, ...signal },
    });
    expect(result.state).toBe('BLOCKED');
    expect(result.reason).toBe(reason);
  });

  it('fails closed for unknown suppression and provenance evidence', () => {
    const result = classifyTechnicalEmail({ ...validInput, suppression: { ...suppression, complaint: 'UNKNOWN' }, publicBusinessProvenance: 'UNKNOWN' });
    expect(result.state).toBe('UNCERTAIN');
    expect(result.reason).toBe('SUPPRESSION_EVIDENCE_UNKNOWN');
  });

  it.each([
    ['timeout', () => new Promise<unknown>(() => undefined), 'DNS_TIMEOUT'],
    ['resolver error', () => Promise.reject(new Error('resolver failure')), 'DNS_RESOLVER_ERROR'],
    ['malformed response', () => Promise.resolve({ malformed: true }), 'DNS_RESPONSE_MALFORMED'],
  ] as const)('converts %s into UNCERTAIN without throwing', async (_label, resolve, reason) => {
    const result = await evaluateTechnicalEmail(validInput, { resolve }, { timeoutMs: 10 });
    expect(result.state).toBe('UNCERTAIN');
    expect(result.reason).toBe(reason);
  });

  it('returns UNCERTAIN when no resolver is configured', async () => {
    const result = await evaluateTechnicalEmail(validInput);
    expect(result.state).toBe('UNCERTAIN');
    expect(result.reason).toBe('DNS_RESULT_UNKNOWN');
  });

  it('fails closed for malformed runtime input and never leaks it', () => {
    const result = classifyTechnicalEmail({ ...validInput, email: { value: email }, domainResolution: { domainExists: 'YES', mx: 'PRESENT' } });
    expect(result.state).toBe('UNCERTAIN');
    expect(result.reason).toBe('INVALID_INPUT');
    expect(JSON.stringify(result)).not.toContain(email);
  });

  it('is deterministic and idempotent for the same evidence', () => {
    expect(classifyTechnicalEmail(validInput)).toEqual(classifyTechnicalEmail(validInput));
  });

  it('does not call a network resolver in unit tests', async () => {
    const { resolver, resolve } = resolverFor({ domainExists: 'YES', mx: 'PRESENT' });
    const result = await evaluateTechnicalEmail(validInput, resolver);
    expect(result.state).toBe('VALID');
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('technical email integration with LQI', () => {
  it('keeps a valid technical result compatible without adding score points', () => {
    const result = evaluateLeadQualification({ evidence: completeEvidence, technicalEmail: classifyTechnicalEmail(validInput) });
    expect(result.eligible).toBe(true);
    expect(result.score.total).toBe(100);
    expect(result.rejectionReasons).toEqual([]);
  });

  it('maps INVALID and UNCERTAIN to existing fail-closed gates', () => {
    const invalid = evaluateLeadQualification({
      evidence: completeEvidence,
      technicalEmail: classifyTechnicalEmail({ ...validInput, domainResolution: { domainExists: 'NO', mx: 'UNKNOWN' } }),
    });
    const uncertain = evaluateLeadQualification({
      evidence: completeEvidence,
      technicalEmail: classifyTechnicalEmail({ ...validInput, publicBusinessProvenance: 'UNKNOWN' }),
    });
    expect(invalid.score.total).toBe(100);
    expect(invalid.eligible).toBe(false);
    expect(invalid.blockingReasons).toContain('BUSINESS_EMAIL_NOT_CONFIRMED');
    expect(uncertain.blockingReasons).toContain('AMBIGUOUS_RESULT');
  });

  it('maps hard bounce to BOUNCE_FOUND even when score is 100', () => {
    const result = evaluateLeadQualification({
      evidence: completeEvidence,
      technicalEmail: classifyTechnicalEmail({ ...validInput, suppression: { ...suppression, hardBounce: true } }),
    });
    expect(result.score.total).toBe(100);
    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toContain('BOUNCE_FOUND');
  });

  it('fails closed for a malformed technical result supplied at runtime', () => {
    const result = evaluateLeadQualification({ evidence: completeEvidence, technicalEmail: { state: 'VALID' } });
    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toContain('AMBIGUOUS_RESULT');
    expect(result.technicalEmail?.state).toBe('UNCERTAIN');
  });
});
