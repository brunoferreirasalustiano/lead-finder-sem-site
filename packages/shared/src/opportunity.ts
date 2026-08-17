export const opportunityStates = [
  'OPPORTUNITY_PENDING_EVIDENCE',
  'OPPORTUNITY_READY',
  'CONTACTABLE',
  'SEND_ELIGIBLE',
  'BLOCKED',
] as const;

export type OpportunityState = (typeof opportunityStates)[number];

export const opportunityReasons = [
  'BUSINESS_IDENTITY_PENDING',
  'BUSINESS_ACTIVITY_PENDING',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_BUSINESS_ASSOCIATION_UNVERIFIED',
  'OFFICIAL_SITE_FOUND',
  'OFFICIAL_SITE_UNCONFIRMED',
  'SITE_SEARCH_NOT_HIGH_CONFIDENCE',
  'CURRENT_EVIDENCE_REQUIRED',
  'LEGACY_STATUS_ONLY',
  'PRIOR_CONTACT',
  'DUPLICATE',
  'PENDING_OR_AMBIGUOUS_SEND',
  'SUPPRESSED',
  'HARD_BOUNCE',
  'OPT_OUT',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'EMAIL_CHANNEL_BLOCKED',
] as const;

export type OpportunityReason = (typeof opportunityReasons)[number];

export type OpportunitySignals = Readonly<{
  businessIdentityConfirmed: boolean;
  businessActivePass: boolean;
  publicBusinessEmailPresent: boolean;
  emailBusinessAssociationPass: boolean;
  officialSiteFound: boolean;
  siteSearchHigh: boolean;
  priorContact: boolean;
  duplicate: boolean;
  pendingOrAmbiguousSend: boolean;
  suppressed: boolean;
  hardBounce: boolean;
  optOut: boolean;
  doNotContact: boolean;
  naoContatar: boolean;
  emailChannelAllowed: boolean;
  currentVerifiedEvidenceRequired: boolean;
  legacyStatusOnly: boolean;
}>;

export type OpportunityEvaluation = Readonly<{
  state: OpportunityState;
  reasons: readonly OpportunityReason[];
  sendEligible: boolean;
  contactable: boolean;
}>;

const safetyReasons = (signals: OpportunitySignals): OpportunityReason[] => {
  const reasons: OpportunityReason[] = [];
  if (signals.priorContact) reasons.push('PRIOR_CONTACT');
  if (signals.duplicate) reasons.push('DUPLICATE');
  if (signals.pendingOrAmbiguousSend) reasons.push('PENDING_OR_AMBIGUOUS_SEND');
  if (signals.suppressed) reasons.push('SUPPRESSED');
  if (signals.hardBounce) reasons.push('HARD_BOUNCE');
  if (signals.optOut) reasons.push('OPT_OUT');
  if (signals.doNotContact) reasons.push('DO_NOT_CONTACT');
  if (signals.naoContatar) reasons.push('NAO_CONTATAR');
  if (!signals.emailChannelAllowed) reasons.push('EMAIL_CHANNEL_BLOCKED');
  return reasons;
};

/**
 * Opportunity discovery is intentionally broader than zero-touch sending.
 * Missing contact/evidence keeps a record in the opportunity funnel, while
 * suppression and identity-reuse controls remain hard blockers.
 */
export const evaluateOpportunity = (signals: OpportunitySignals): OpportunityEvaluation => {
  const reasons = safetyReasons(signals);
  if (!signals.businessIdentityConfirmed) reasons.push('BUSINESS_IDENTITY_PENDING');
  if (!signals.businessActivePass) reasons.push('BUSINESS_ACTIVITY_PENDING');
  if (!signals.publicBusinessEmailPresent) reasons.push('EMAIL_NOT_VERIFIED');
  if (signals.publicBusinessEmailPresent && !signals.emailBusinessAssociationPass) {
    reasons.push('EMAIL_BUSINESS_ASSOCIATION_UNVERIFIED');
  }
  if (signals.officialSiteFound) reasons.push('OFFICIAL_SITE_FOUND');
  if (!signals.siteSearchHigh) reasons.push('SITE_SEARCH_NOT_HIGH_CONFIDENCE');
  if (!signals.currentVerifiedEvidenceRequired) reasons.push('CURRENT_EVIDENCE_REQUIRED');
  if (signals.legacyStatusOnly) reasons.push('LEGACY_STATUS_ONLY');

  const uniqueReasons = [...new Set(reasons)];
  const safetyBlocked = safetyReasons(signals).length > 0;
  const contactable = !safetyBlocked
    && signals.businessIdentityConfirmed
    && signals.businessActivePass
    && signals.publicBusinessEmailPresent
    && signals.emailBusinessAssociationPass;
  const sendEligible = contactable
    && !signals.officialSiteFound
    && signals.siteSearchHigh
    && signals.currentVerifiedEvidenceRequired
    && !signals.legacyStatusOnly;

  if (safetyBlocked) return { state: 'BLOCKED', reasons: uniqueReasons, sendEligible: false, contactable: false };
  if (sendEligible) return { state: 'SEND_ELIGIBLE', reasons: uniqueReasons, sendEligible: true, contactable: true };
  if (contactable) return { state: 'CONTACTABLE', reasons: uniqueReasons, sendEligible: false, contactable: true };
  if (signals.businessIdentityConfirmed && signals.businessActivePass) {
    return { state: 'OPPORTUNITY_READY', reasons: uniqueReasons, sendEligible: false, contactable: false };
  }
  return { state: 'OPPORTUNITY_PENDING_EVIDENCE', reasons: uniqueReasons, sendEligible: false, contactable: false };
};
