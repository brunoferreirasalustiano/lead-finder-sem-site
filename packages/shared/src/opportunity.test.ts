import { describe, expect, it } from 'vitest';
import { evaluateOpportunity, type OpportunitySignals } from './opportunity.js';

const complete: OpportunitySignals = {
  businessIdentityConfirmed: true,
  businessActivePass: true,
  publicBusinessEmailPresent: true,
  emailBusinessAssociationPass: true,
  officialSiteFound: false,
  siteSearchHigh: true,
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

describe('opportunity evaluation', () => {
  it('keeps a business opportunity without a verified email out of sending', () => {
    const result = evaluateOpportunity({ ...complete, publicBusinessEmailPresent: false });
    expect(result.state).toBe('OPPORTUNITY_READY');
    expect(result.sendEligible).toBe(false);
    expect(result.reasons).toContain('EMAIL_NOT_VERIFIED');
  });

  it('keeps an email with unknown business association contactable but not sendable', () => {
    const result = evaluateOpportunity({ ...complete, emailBusinessAssociationPass: false });
    expect(result.state).toBe('OPPORTUNITY_READY');
    expect(result.contactable).toBe(false);
    expect(result.reasons).toContain('EMAIL_BUSINESS_ASSOCIATION_UNVERIFIED');
  });

  it('only marks a complete current-evidence record send eligible', () => {
    expect(evaluateOpportunity(complete)).toMatchObject({
      state: 'SEND_ELIGIBLE',
      contactable: true,
      sendEligible: true,
    });
  });

  it('does not let an official site erase the opportunity, but blocks this no-site campaign', () => {
    const result = evaluateOpportunity({ ...complete, officialSiteFound: true });
    expect(result.state).toBe('CONTACTABLE');
    expect(result.sendEligible).toBe(false);
    expect(result.reasons).toContain('OFFICIAL_SITE_FOUND');
  });

  it('keeps missing identity/activity in evidence-pending state', () => {
    const result = evaluateOpportunity({ ...complete, businessIdentityConfirmed: false, businessActivePass: false });
    expect(result.state).toBe('OPPORTUNITY_PENDING_EVIDENCE');
    expect(result.reasons).toEqual(expect.arrayContaining(['BUSINESS_IDENTITY_PENDING', 'BUSINESS_ACTIVITY_PENDING']));
  });

  it.each([
    ['suppressed', { suppressed: true }],
    ['hard bounce', { hardBounce: true }],
    ['opt-out', { optOut: true }],
    ['do not contact', { doNotContact: true }],
    ['duplicate', { duplicate: true }],
  ] as const)('keeps %s fail-closed', (_label, override) => {
    const result = evaluateOpportunity({ ...complete, ...override });
    expect(result.state).toBe('BLOCKED');
    expect(result.sendEligible).toBe(false);
  });
});
