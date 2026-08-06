import {
  inspectEmailSyntax,
  technicalEmailReasons,
  type TechnicalEmailQualificationResult,
  type TechnicalEmailSafetySignal,
} from './email-qualification.js';

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
  /** Optional deterministic technical email gate. It never contributes additional score points. */
  technicalEmail?: unknown;
}

export interface LeadQualificationResult {
  eligible: boolean;
  score: LeadQualityScore;
  blockingReasons: readonly LeadBlockingReason[];
  rejectionReasons: readonly LeadRejectionReason[];
  /** Safe technical outcome; this contains no complete email address. */
  technicalEmail?: TechnicalEmailQualificationResult;
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

const isTechnicalEmailSafetySignal = (value: unknown): value is TechnicalEmailSafetySignal =>
  typeof value === 'string' && ['HARD_BOUNCE', 'OPT_OUT', 'COMPLAINT', 'DO_NOT_CONTACT', 'NAO_CONTATAR', 'BLOCKED'].includes(value);

const isTechnicalEmailResult = (value: unknown): value is TechnicalEmailQualificationResult => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!technicalEmailReasons.includes(candidate.reason as (typeof technicalEmailReasons)[number])) return false;
  if (!['VALID', 'INVALID', 'UNCERTAIN', 'BLOCKED'].includes(String(candidate.state))) return false;
  if (!['VALID', 'INVALID', 'UNKNOWN'].includes(String(candidate.syntax))) return false;
  if (!['YES', 'NO', 'UNKNOWN'].includes(String(candidate.domainExists))) return false;
  if (!['PRESENT', 'ABSENT', 'UNKNOWN'].includes(String(candidate.mx))) return false;
  if (!['CONFIRMED', 'NOT_CONFIRMED', 'UNKNOWN'].includes(String(candidate.publicBusinessProvenance))) return false;
  if (!Array.isArray(candidate.blockedBy) || !candidate.blockedBy.every(isTechnicalEmailSafetySignal)) return false;
  if (candidate.state === 'VALID') {
    const domainInspection = typeof candidate.domain === 'string' ? inspectEmailSyntax(`a@${candidate.domain}`) : null;
    return candidate.syntax === 'VALID' && candidate.domainExists === 'YES' && candidate.mx === 'PRESENT'
      && candidate.publicBusinessProvenance === 'CONFIRMED' && candidate.reason === 'VALIDATED'
      && candidate.blockedBy.length === 0 && domainInspection?.valid === true && domainInspection.domain === candidate.domain;
  }
  return true;
};

const fallbackTechnicalEmailResult = (): TechnicalEmailQualificationResult => ({
  state: 'UNCERTAIN',
  domain: null,
  syntax: 'UNKNOWN',
  domainExists: 'UNKNOWN',
  mx: 'UNKNOWN',
  publicBusinessProvenance: 'UNKNOWN',
  blockedBy: [],
  reason: 'INVALID_INPUT',
});

const technicalEmailBlockingReasons = (result: TechnicalEmailQualificationResult): LeadBlockingReason[] => {
  if (result.state === 'VALID') return [];
  if (result.state === 'INVALID') return ['BUSINESS_EMAIL_NOT_CONFIRMED'];
  if (result.state === 'UNCERTAIN') return ['AMBIGUOUS_RESULT'];
  const mapped: LeadBlockingReason[] = [];
  for (const signal of result.blockedBy) {
    if (signal === 'HARD_BOUNCE') mapped.push('BOUNCE_FOUND');
    else if (signal === 'OPT_OUT') mapped.push('OPT_OUT_FOUND');
    else if (signal === 'COMPLAINT') mapped.push('COMPLAINT_FOUND');
    else if (signal === 'DO_NOT_CONTACT') mapped.push('DO_NOT_CONTACT');
    else if (signal === 'NAO_CONTATAR') mapped.push('NAO_CONTATAR');
    else if (signal === 'BLOCKED') mapped.push('BLOCKED');
  }
  return mapped.length > 0 ? mapped : ['BLOCKED'];
};

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
  const technicalEmail = input.technicalEmail === undefined
    ? undefined
    : isTechnicalEmailResult(input.technicalEmail) ? input.technicalEmail : fallbackTechnicalEmailResult();
  const requestedBlockingReasons: LeadBlockingReason[] = [];
  const blockingReasonsInputInvalid = input.blockingReasons !== undefined && !Array.isArray(input.blockingReasons);
  if (Array.isArray(input.blockingReasons)) {
    requestedBlockingReasons.push(...(input.blockingReasons as readonly LeadBlockingReason[]));
  }
  if (input.technicalEmail !== undefined) {
    requestedBlockingReasons.push(...technicalEmailBlockingReasons(technicalEmail ?? fallbackTechnicalEmailResult()));
  }
  const normalized = normalizeBlockingReasons(requestedBlockingReasons);
  if (blockingReasonsInputInvalid) normalized.invalidInput = true;
  if (input.technicalEmail !== undefined && !isTechnicalEmailResult(input.technicalEmail)) normalized.invalidInput = true;
  if (normalized.invalidInput && !normalized.reasons.includes('AMBIGUOUS_RESULT')) normalized.reasons.push('AMBIGUOUS_RESULT');
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

  if (technicalEmail !== undefined) return { eligible, score, blockingReasons, rejectionReasons, technicalEmail };
  return { eligible, score, blockingReasons, rejectionReasons };
}
