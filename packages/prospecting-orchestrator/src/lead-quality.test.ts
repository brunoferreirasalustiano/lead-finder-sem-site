import { describe, expect, it } from 'vitest';
import {
  calculateLeadQualityScore,
  evaluateLeadQualification,
  type LeadQualificationEvidence,
  type LeadBlockingReason,
} from './lead-quality.js';

const completeEvidence: LeadQualificationEvidence = {
  apparentActivity: true,
  noOfficialDomain: true,
  publicBusinessEmail: true,
  noPreviousContact: true,
  noSuppressionOrBounce: true,
};

const withBlockingReason = (reason: LeadBlockingReason) =>
  evaluateLeadQualification({ evidence: completeEvidence, blockingReasons: [reason] });

describe('lead quality score', () => {
  it('returns score 100 when every criterion is present', () => {
    const result = evaluateLeadQualification({ evidence: completeEvidence });
    expect(result.score).toEqual({
      total: 100,
      breakdown: { apparentActivity: 20, noOfficialDomain: 25, publicBusinessEmail: 25, noPreviousContact: 15, noSuppressionOrBounce: 15 },
    });
    expect(result.eligible).toBe(true);
  });

  it('accepts the exact threshold when safety gates have no blocking reason', () => {
    const result = evaluateLeadQualification({
      evidence: { ...completeEvidence, apparentActivity: false },
    });
    expect(result.score.total).toBe(80);
    expect(result.eligible).toBe(true);
  });

  it.each([
    ['previous contact', 'PREVIOUS_CONTACT_FOUND'],
    ['opt out', 'OPT_OUT_FOUND'],
    ['do not contact', 'DO_NOT_CONTACT'],
    ['NAO_CONTATAR', 'NAO_CONTATAR'],
    ['bounce', 'BOUNCE_FOUND'],
    ['official site', 'OFFICIAL_DOMAIN_FOUND'],
  ] as const)('rejects a score above threshold with %s', (_label, reason) => {
    const result = withBlockingReason(reason);
    expect(result.score.total).toBeGreaterThan(80);
    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toContain(reason);
    expect(result.rejectionReasons).toContain(reason);
  });

  it('rejects a score below threshold', () => {
    const result = evaluateLeadQualification({ evidence: { ...completeEvidence, publicBusinessEmail: false, noOfficialDomain: false } });
    expect(result.score.total).toBe(50);
    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toContain('SCORE_BELOW_THRESHOLD');
  });

  it('fails closed for ambiguous results and audit failures', () => {
    expect(withBlockingReason('AMBIGUOUS_RESULT').eligible).toBe(false);
    expect(withBlockingReason('AUDIT_FAILURE').eligible).toBe(false);
  });

  it('returns every simultaneous blocking reason without duplicates', () => {
    const reasons: LeadBlockingReason[] = ['OPT_OUT_FOUND', 'DUPLICATE_FOUND', 'BOUNCE_FOUND', 'OPT_OUT_FOUND'];
    const result = evaluateLeadQualification({ evidence: completeEvidence, blockingReasons: reasons });
    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toEqual(['DUPLICATE_FOUND', 'BOUNCE_FOUND', 'OPT_OUT_FOUND']);
    expect(result.rejectionReasons).toEqual(['DUPLICATE_FOUND', 'BOUNCE_FOUND', 'OPT_OUT_FOUND']);
  });

  it('keeps breakdown bounded and exactly additive', () => {
    const score = calculateLeadQualityScore({
      apparentActivity: false,
      noOfficialDomain: true,
      publicBusinessEmail: false,
      noPreviousContact: true,
      noSuppressionOrBounce: false,
    });
    expect(score.total).toBe(Object.values(score.breakdown).reduce((sum, value) => sum + value, 0));
    expect(Object.values(score.breakdown).every((value) => value >= 0 && value <= 100)).toBe(true);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it('fails closed for invalid evidence or insufficient evidence', () => {
    const invalid = evaluateLeadQualification({ evidence: { ...completeEvidence, apparentActivity: 'unknown' as unknown as boolean } });
    expect(invalid.eligible).toBe(false);
    expect(invalid.blockingReasons).toEqual(['AMBIGUOUS_RESULT']);
    const empty = evaluateLeadQualification({
      evidence: { apparentActivity: false, noOfficialDomain: false, publicBusinessEmail: false, noPreviousContact: false, noSuppressionOrBounce: false },
    });
    expect(empty.rejectionReasons).toEqual(['SCORE_BELOW_THRESHOLD', 'INSUFFICIENT_EVIDENCE']);
  });

  it('fails closed when blocking reasons have an unexpected runtime shape', () => {
    const result = evaluateLeadQualification({ evidence: completeEvidence, blockingReasons: { reason: 'OPT_OUT_FOUND' } as unknown as readonly LeadBlockingReason[] });
    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toEqual(['AMBIGUOUS_RESULT']);
  });
});
