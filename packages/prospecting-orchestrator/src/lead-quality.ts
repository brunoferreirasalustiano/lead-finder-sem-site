export const LEAD_QUALITY_THRESHOLD = 80;

export const LEAD_QUALITY_WEIGHTS = {
  apparentActivity: 20,
  noOfficialDomain: 25,
  publicBusinessEmail: 25,
  noPreviousContact: 15,
  noSuppressionOrBounce: 15,
} as const;

export interface LeadQualificationEvidence {
  apparentActivity: boolean;
  noOfficialDomain: boolean;
  publicBusinessEmail: boolean;
  noPreviousContact: boolean;
  noSuppressionOrBounce: boolean;
}

export const leadBlockingReasons = [
  'INACTIVE_OR_UNCERTAIN_ACTIVITY',
  'OFFICIAL_DOMAIN_FOUND',
  'BUSINESS_EMAIL_NOT_CONFIRMED',
  'PREVIOUS_CONTACT_FOUND',
  'DUPLICATE_FOUND',
  'BOUNCE_FOUND',
  'OPT_OUT_FOUND',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'BLOCKED',
  'COMPLAINT_FOUND',
  'AUDIT_FAILURE',
  'AMBIGUOUS_RESULT',
] as const;

export type LeadBlockingReason = (typeof leadBlockingReasons)[number];

export type LeadRejectionReason = LeadBlockingReason | 'SCORE_BELOW_THRESHOLD' | 'INSUFFICIENT_EVIDENCE';

export interface LeadQualityScore {
  total: number;
  breakdown: {
    apparentActivity: number;
    noOfficialDomain: number;
    publicBusinessEmail: number;
    noPreviousContact: number;
    noSuppressionOrBounce: number;
  };
}

export interface LeadQualificationInput {
  evidence: LeadQualificationEvidence;
  /** Explicit safety-gate failures. Unknown runtime values fail closed as AMBIGUOUS_RESULT. */
  blockingReasons?: readonly LeadBlockingReason[];
}

export interface LeadQualificationResult {
  eligible: boolean;
  score: LeadQualityScore;
  blockingReasons: readonly LeadBlockingReason[];
  rejectionReasons: readonly LeadRejectionReason[];
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const hasValidEvidence = (evidence: unknown): evidence is LeadQualificationEvidence => {
  if (typeof evidence !== 'object' || evidence === null) return false;
  const candidate = evidence as Record<string, unknown>;
  return (
    isBoolean(candidate.apparentActivity) &&
    isBoolean(candidate.noOfficialDomain) &&
    isBoolean(candidate.publicBusinessEmail) &&
    isBoolean(candidate.noPreviousContact) &&
    isBoolean(candidate.noSuppressionOrBounce)
  );
};

const isLeadBlockingReason = (value: unknown): value is LeadBlockingReason =>
  typeof value === 'string' && (leadBlockingReasons as readonly string[]).includes(value);

function normalizeBlockingReasons(reasons: readonly LeadBlockingReason[] | undefined): {
  reasons: LeadBlockingReason[];
  invalidInput: boolean;
} {
  const requested = Array.isArray(reasons) ? reasons : [];
  const selected = new Set<LeadBlockingReason>();
  let invalidInput = reasons !== undefined && !Array.isArray(reasons);

  for (const reason of requested) {
    if (isLeadBlockingReason(reason)) selected.add(reason);
    else invalidInput = true;
  }

  if (invalidInput) selected.add('AMBIGUOUS_RESULT');
  return {
    reasons: leadBlockingReasons.filter((reason) => selected.has(reason)),
    invalidInput,
  };
}

export function calculateLeadQualityScore(evidence: LeadQualificationEvidence): LeadQualityScore {
  const breakdown = {
    apparentActivity: evidence.apparentActivity ? LEAD_QUALITY_WEIGHTS.apparentActivity : 0,
    noOfficialDomain: evidence.noOfficialDomain ? LEAD_QUALITY_WEIGHTS.noOfficialDomain : 0,
    publicBusinessEmail: evidence.publicBusinessEmail ? LEAD_QUALITY_WEIGHTS.publicBusinessEmail : 0,
    noPreviousContact: evidence.noPreviousContact ? LEAD_QUALITY_WEIGHTS.noPreviousContact : 0,
    noSuppressionOrBounce: evidence.noSuppressionOrBounce ? LEAD_QUALITY_WEIGHTS.noSuppressionOrBounce : 0,
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

export function evaluateLeadQualification(input: LeadQualificationInput): LeadQualificationResult {
  const evidenceIsValid = hasValidEvidence(input.evidence);
  const score = evidenceIsValid
    ? calculateLeadQualityScore(input.evidence)
    : {
        total: 0,
        breakdown: {
          apparentActivity: 0,
          noOfficialDomain: 0,
          publicBusinessEmail: 0,
          noPreviousContact: 0,
          noSuppressionOrBounce: 0,
        },
      };
  const normalized = normalizeBlockingReasons(input.blockingReasons);
  const blockingReasons = [...normalized.reasons];
  if (!evidenceIsValid && !blockingReasons.includes('AMBIGUOUS_RESULT')) blockingReasons.push('AMBIGUOUS_RESULT');

  const rejectionReasons: LeadRejectionReason[] = [...blockingReasons];
  if (score.total < LEAD_QUALITY_THRESHOLD) rejectionReasons.push('SCORE_BELOW_THRESHOLD');
  if (evidenceIsValid && Object.values(input.evidence).every((value) => value === false)) {
    rejectionReasons.push('INSUFFICIENT_EVIDENCE');
  }

  const eligible =
    evidenceIsValid &&
    score.total >= LEAD_QUALITY_THRESHOLD &&
    blockingReasons.length === 0 &&
    rejectionReasons.length === 0;

  return { eligible, score, blockingReasons, rejectionReasons };
}
