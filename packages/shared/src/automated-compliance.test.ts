import { describe, expect, it } from 'vitest';
import { evaluateAutomatedCompliance, evaluateDaily6Quota, type AutomatedComplianceInput } from './automated-compliance.js';

const passingInput: AutomatedComplianceInput = {
  businessIdentityConfirmed: true,
  businessActive: 'PASS',
  publicBusinessEmailPresent: true,
  emailBusinessAssociation: 'PASS',
  emailInferred: false,
  officialSiteFound: false,
  siteSearchConfidence: 'HIGH',
  priorContact: false,
  duplicate: false,
  pendingOrAmbiguousSend: false,
  suppressed: false,
  hardBounce: false,
  optOut: false,
  doNotContact: false,
  naoContatar: false,
  emailChannelAllowed: true,
  currentVerifiedEvidenceRequired: true,
  legacyStatusOnly: false,
};

describe('automated compliance gate', () => {
  it('passes only when all current evidence and suppression gates pass', () => {
    expect(evaluateAutomatedCompliance(passingInput)).toMatchObject({ gate: 'PASS', readyToSend: true, reasons: [] });
  });

  it.each([
    ['unknown activity', { businessActive: 'UNCERTAIN' as const }, 'BUSINESS_ACTIVITY_NOT_PASS'],
    ['medium site confidence', { siteSearchConfidence: 'MEDIUM' as const }, 'SITE_SEARCH_NOT_HIGH_CONFIDENCE'],
    ['legacy status only', { currentVerifiedEvidenceRequired: false, legacyStatusOnly: true }, 'LEGACY_STATUS_ONLY'],
    ['suppressed recipient', { suppressed: true }, 'SUPPRESSED'],
  ])('fails closed for %s', (_label, override, reason) => {
    const result = evaluateAutomatedCompliance({ ...passingInput, ...override });
    expect(result.gate).toBe('FAIL');
    expect(result.readyToSend).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it('enforces the immutable daily-6 limits and hard-bounce stop', () => {
    expect(evaluateDaily6Quota({ batchSent: 0, dailySent: 5, sameDayHardBounces: 0 }).allowed).toBe(true);
    expect(evaluateDaily6Quota({ batchSent: 2, dailySent: 2, sameDayHardBounces: 0 })).toEqual({ allowed: false, reason: 'BATCH_QUOTA_EXHAUSTED' });
    expect(evaluateDaily6Quota({ batchSent: 0, dailySent: 6, sameDayHardBounces: 0 })).toEqual({ allowed: false, reason: 'DAILY_QUOTA_EXHAUSTED' });
    expect(evaluateDaily6Quota({ batchSent: 0, dailySent: 1, sameDayHardBounces: 2 })).toEqual({ allowed: false, reason: 'HARD_BOUNCE_STOP' });
  });
});
