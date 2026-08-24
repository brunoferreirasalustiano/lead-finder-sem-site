import { describe, expect, it } from 'vitest';
import {
  evaluateDaily6OpportunityShadow,
  type Daily6OpportunityShadowSignals,
} from './daily6-opportunity-shadow.js';

const complete: Daily6OpportunityShadowSignals = {
  identity: 'CONFIRMED',
  activity: 'ACTIVE',
  email: 'PASS',
  website: 'NO_OFFICIAL_SITE_CONFIRMED',
  businessClosed: false,
  currentEvidencePresent: true,
  legacyStatusOnly: false,
  blockedLead: false,
  priorContact: false,
  duplicate: false,
  pendingOrAmbiguousSend: false,
  suppressed: false,
  hardBounce: false,
  optOut: false,
  doNotContact: false,
  naoContatar: false,
  emailChannelAllowed: true,
};

describe('Daily-6 opportunity shadow classifier', () => {
  it('marks complete evidence as an opportunity without send authority', () => {
    expect(evaluateDaily6OpportunityShadow(complete)).toEqual({
      state: 'OPPORTUNITY_READY',
      reasons: [],
      manualReviewOnly: true,
      autoSendAllowed: false,
    });
  });

  it('keeps unknown evidence reviewable', () => {
    const result = evaluateDaily6OpportunityShadow({
      ...complete,
      identity: 'UNKNOWN',
      activity: 'UNKNOWN',
      email: 'UNKNOWN',
      website: 'UNKNOWN',
      currentEvidencePresent: false,
      legacyStatusOnly: true,
    });
    expect(result.state).toBe('REVIEW_REQUIRED');
    expect(result.reasons).toEqual(expect.arrayContaining([
      'IDENTITY_UNKNOWN',
      'BUSINESS_ACTIVITY_UNKNOWN',
      'EMAIL_UNKNOWN',
      'WEBSITE_UNKNOWN',
      'CURRENT_EVIDENCE_MISSING',
      'LEGACY_STATUS_ONLY',
    ]));
    expect(result.manualReviewOnly).toBe(true);
    expect(result.autoSendAllowed).toBe(false);
  });

  it('does not qualify confirmed negative evidence and reviews missing email', () => {
    expect(evaluateDaily6OpportunityShadow({ ...complete, identity: 'UNCONFIRMED' }).state).toBe('NOT_QUALIFIED');
    expect(evaluateDaily6OpportunityShadow({ ...complete, activity: 'INACTIVE' }).state).toBe('NOT_QUALIFIED');
    expect(evaluateDaily6OpportunityShadow({ ...complete, businessClosed: true }).state).toBe('NOT_QUALIFIED');
    expect(evaluateDaily6OpportunityShadow({ ...complete, email: 'MISSING' }).state).toBe('REVIEW_REQUIRED');
    expect(evaluateDaily6OpportunityShadow({ ...complete, email: 'UNSUITABLE' })).toMatchObject({
      state: 'REVIEW_REQUIRED',
      reasons: ['EMAIL_UNSUITABLE'],
      autoSendAllowed: false,
    });
    expect(evaluateDaily6OpportunityShadow({ ...complete, website: 'OFFICIAL_SITE_FOUND' }).state).toBe('NOT_QUALIFIED');
  });

  it.each([
    ['blocked lead', { blockedLead: true, reason: 'BLOCKED_LEAD' }],
    ['prior contact', { priorContact: true, reason: 'PRIOR_CONTACT' }],
    ['duplicate', { duplicate: true, reason: 'DUPLICATE' }],
    ['pending send', { pendingOrAmbiguousSend: true, reason: 'PENDING_OR_AMBIGUOUS_SEND' }],
    ['suppressed', { suppressed: true, reason: 'SUPPRESSED' }],
    ['hard bounce', { hardBounce: true, reason: 'HARD_BOUNCE' }],
    ['opt out', { optOut: true, reason: 'OPT_OUT' }],
    ['do not contact', { doNotContact: true, reason: 'DO_NOT_CONTACT' }],
    ['NAO_CONTATAR', { naoContatar: true, reason: 'NAO_CONTATAR' }],
    ['blocked email channel', { emailChannelAllowed: false, reason: 'EMAIL_CHANNEL_BLOCKED' }],
  ] as const)('keeps %s hard blocked', (_label, override) => {
    const result = evaluateDaily6OpportunityShadow({ ...complete, ...override });
    expect(result.state).toBe('HARD_BLOCKED');
    expect(result.reasons).toContain(override.reason);
    expect(result.manualReviewOnly).toBe(true);
    expect(result.autoSendAllowed).toBe(false);
  });
});
