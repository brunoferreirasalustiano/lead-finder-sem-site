export const opportunityShadowIdentityStatuses = ['CONFIRMED', 'UNKNOWN', 'UNCONFIRMED'] as const;
export type OpportunityShadowIdentityStatus = (typeof opportunityShadowIdentityStatuses)[number];

export const opportunityShadowActivityStatuses = ['ACTIVE', 'UNKNOWN', 'INACTIVE'] as const;
export type OpportunityShadowActivityStatus = (typeof opportunityShadowActivityStatuses)[number];

export const opportunityShadowEmailStatuses = ['PASS', 'UNKNOWN', 'MISSING', 'UNSUITABLE'] as const;
export type OpportunityShadowEmailStatus = (typeof opportunityShadowEmailStatuses)[number];

export const opportunityShadowWebsiteStatuses = [
  'NO_OFFICIAL_SITE_CONFIRMED',
  'UNKNOWN',
  'OFFICIAL_SITE_FOUND',
] as const;
export type OpportunityShadowWebsiteStatus = (typeof opportunityShadowWebsiteStatuses)[number];

export const opportunityShadowStates = [
  'HARD_BLOCKED',
  'NOT_QUALIFIED',
  'REVIEW_REQUIRED',
  'OPPORTUNITY_READY',
] as const;
export type OpportunityShadowState = (typeof opportunityShadowStates)[number];

export const opportunityShadowHardReasons = [
  'BLOCKED_LEAD',
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
export type OpportunityShadowHardReason = (typeof opportunityShadowHardReasons)[number];

export const opportunityShadowQualityReasons = [
  'IDENTITY_UNCONFIRMED',
  'IDENTITY_UNKNOWN',
  'BUSINESS_NOT_ACTIVE',
  'BUSINESS_ACTIVITY_UNKNOWN',
  'EMAIL_MISSING',
  'EMAIL_UNKNOWN',
  'EMAIL_UNSUITABLE',
  'OFFICIAL_SITE_FOUND',
  'WEBSITE_UNKNOWN',
  'BUSINESS_CLOSED',
  'CURRENT_EVIDENCE_MISSING',
  'LEGACY_STATUS_ONLY',
] as const;
export type OpportunityShadowQualityReason = (typeof opportunityShadowQualityReasons)[number];
export type OpportunityShadowReason = OpportunityShadowHardReason | OpportunityShadowQualityReason;

export type Daily6OpportunityShadowSignals = Readonly<{
  identity: OpportunityShadowIdentityStatus;
  activity: OpportunityShadowActivityStatus;
  email: OpportunityShadowEmailStatus;
  website: OpportunityShadowWebsiteStatus;
  businessClosed: boolean;
  currentEvidencePresent: boolean;
  legacyStatusOnly: boolean;
  blockedLead: boolean;
  priorContact: boolean;
  duplicate: boolean;
  pendingOrAmbiguousSend: boolean;
  suppressed: boolean;
  hardBounce: boolean;
  optOut: boolean;
  doNotContact: boolean;
  naoContatar: boolean;
  emailChannelAllowed: boolean;
}>;

export type Daily6OpportunityShadowEvaluation = Readonly<{
  state: OpportunityShadowState;
  reasons: readonly OpportunityShadowReason[];
  manualReviewOnly: true;
  autoSendAllowed: false;
}>;

const hardReasons = (signals: Daily6OpportunityShadowSignals): OpportunityShadowHardReason[] => {
  const reasons: OpportunityShadowHardReason[] = [];
  if (signals.blockedLead) reasons.push('BLOCKED_LEAD');
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

const qualityReasons = (signals: Daily6OpportunityShadowSignals): OpportunityShadowQualityReason[] => {
  const reasons: OpportunityShadowQualityReason[] = [];
  if (signals.identity === 'UNCONFIRMED') reasons.push('IDENTITY_UNCONFIRMED');
  if (signals.identity === 'UNKNOWN') reasons.push('IDENTITY_UNKNOWN');
  if (signals.activity === 'INACTIVE') reasons.push('BUSINESS_NOT_ACTIVE');
  if (signals.activity === 'UNKNOWN') reasons.push('BUSINESS_ACTIVITY_UNKNOWN');
  if (signals.email === 'MISSING') reasons.push('EMAIL_MISSING');
  if (signals.email === 'UNKNOWN') reasons.push('EMAIL_UNKNOWN');
  if (signals.email === 'UNSUITABLE') reasons.push('EMAIL_UNSUITABLE');
  if (signals.website === 'OFFICIAL_SITE_FOUND') reasons.push('OFFICIAL_SITE_FOUND');
  if (signals.website === 'UNKNOWN') reasons.push('WEBSITE_UNKNOWN');
  if (signals.businessClosed) reasons.push('BUSINESS_CLOSED');
  if (!signals.currentEvidencePresent) reasons.push('CURRENT_EVIDENCE_MISSING');
  if (signals.legacyStatusOnly) reasons.push('LEGACY_STATUS_ONLY');
  return reasons;
};

/**
 * Classifies a Daily-6 opportunity without granting any send authority.
 * Unknown evidence remains reviewable, while confirmed negative evidence is
 * not promoted to an opportunity-ready state.
 */
export const evaluateDaily6OpportunityShadow = (
  signals: Daily6OpportunityShadowSignals,
): Daily6OpportunityShadowEvaluation => {
  const hard = hardReasons(signals);
  const quality = qualityReasons(signals);
  const reasons: OpportunityShadowReason[] = [...hard, ...quality];
  const result = (state: OpportunityShadowState): Daily6OpportunityShadowEvaluation => ({
    state,
    reasons,
    manualReviewOnly: true,
    autoSendAllowed: false,
  });

  if (hard.length > 0) return result('HARD_BLOCKED');
  if (quality.some((reason) => [
    'IDENTITY_UNCONFIRMED',
    'BUSINESS_NOT_ACTIVE',
    'OFFICIAL_SITE_FOUND',
    'BUSINESS_CLOSED',
  ].includes(reason))) {
    return result('NOT_QUALIFIED');
  }
  if (quality.length > 0) return result('REVIEW_REQUIRED');
  return result('OPPORTUNITY_READY');
};
