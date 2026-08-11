export const AUTOMATED_COMPLIANCE_POLICY_VERSION = 'daily6-v1' as const;
export const MAX_SENDS_PER_BATCH = 2 as const;
export const MAX_SENDS_PER_DAY = 6 as const;

export type AutomatedComplianceInput = {
  businessIdentityConfirmed: boolean;
  businessActive: 'PASS' | 'FAIL' | 'UNCERTAIN';
  publicBusinessEmailPresent: boolean;
  emailBusinessAssociation: 'PASS' | 'FAIL' | 'UNVERIFIED';
  emailInferred: boolean;
  officialSiteFound: boolean;
  siteSearchConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
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
};

export type AutomatedComplianceResult = {
  policyVersion: typeof AUTOMATED_COMPLIANCE_POLICY_VERSION;
  gate: 'PASS' | 'FAIL';
  readyToSend: boolean;
  reasons: string[];
};

export type Daily6QuotaDecision = {
  allowed: boolean;
  reason?: 'BATCH_QUOTA_EXHAUSTED' | 'DAILY_QUOTA_EXHAUSTED' | 'HARD_BOUNCE_STOP';
};

export const evaluateDaily6Quota = (input: {
  batchSent: number;
  dailySent: number;
  sameDayHardBounces: number;
}): Daily6QuotaDecision => {
  if (!Number.isInteger(input.batchSent) || !Number.isInteger(input.dailySent) || !Number.isInteger(input.sameDayHardBounces)) {
    return { allowed: false, reason: 'DAILY_QUOTA_EXHAUSTED' };
  }
  if (input.sameDayHardBounces >= 2) return { allowed: false, reason: 'HARD_BOUNCE_STOP' };
  if (input.batchSent < 0 || input.dailySent < 0 || input.batchSent >= MAX_SENDS_PER_BATCH) return { allowed: false, reason: 'BATCH_QUOTA_EXHAUSTED' };
  if (input.dailySent >= MAX_SENDS_PER_DAY) return { allowed: false, reason: 'DAILY_QUOTA_EXHAUSTED' };
  return { allowed: true };
};

/**
 * The zero-touch policy is deliberately a conjunction. No score or legacy
 * status can substitute for a failed/unknown compliance requirement.
 */
export const evaluateAutomatedCompliance = (input: AutomatedComplianceInput): AutomatedComplianceResult => {
  const reasons: string[] = [];
  if (!input.businessIdentityConfirmed) reasons.push('BUSINESS_IDENTITY_NOT_CONFIRMED');
  if (input.businessActive !== 'PASS') reasons.push('BUSINESS_ACTIVITY_NOT_PASS');
  if (!input.publicBusinessEmailPresent) reasons.push('BUSINESS_EMAIL_NOT_PUBLIC');
  if (input.emailBusinessAssociation !== 'PASS') reasons.push('BUSINESS_EMAIL_NOT_ASSOCIATED');
  if (input.emailInferred) reasons.push('EMAIL_INFERRED');
  if (input.officialSiteFound) reasons.push('OFFICIAL_SITE_FOUND');
  if (input.siteSearchConfidence !== 'HIGH') reasons.push('SITE_SEARCH_NOT_HIGH_CONFIDENCE');
  if (input.priorContact) reasons.push('PRIOR_CONTACT');
  if (input.duplicate) reasons.push('DUPLICATE');
  if (input.pendingOrAmbiguousSend) reasons.push('PENDING_OR_AMBIGUOUS_SEND');
  if (input.suppressed) reasons.push('SUPPRESSED');
  if (input.hardBounce) reasons.push('HARD_BOUNCE');
  if (input.optOut) reasons.push('OPT_OUT');
  if (input.doNotContact) reasons.push('DO_NOT_CONTACT');
  if (input.naoContatar) reasons.push('NAO_CONTATAR');
  if (!input.emailChannelAllowed) reasons.push('EMAIL_CHANNEL_NOT_ALLOWED');
  if (!input.currentVerifiedEvidenceRequired) reasons.push('CURRENT_EVIDENCE_REQUIRED');
  if (input.legacyStatusOnly) reasons.push('LEGACY_STATUS_ONLY');
  return {
    policyVersion: AUTOMATED_COMPLIANCE_POLICY_VERSION,
    gate: reasons.length === 0 ? 'PASS' : 'FAIL',
    readyToSend: reasons.length === 0,
    reasons,
  };
};
