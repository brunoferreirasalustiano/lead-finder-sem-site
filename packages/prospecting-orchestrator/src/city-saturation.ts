export const prospectingCities = [
  'Campinas',
  'Valinhos',
  'Paulínia',
  'Hortolândia',
  'Sumaré',
  'Indaiatuba',
] as const;

export type ProspectingCity = (typeof prospectingCities)[number];

export const prospectingRejectionReasons = [
  'PREVIOUS_CONTACT',
  'DUPLICATE',
  'OFFICIAL_SITE',
  'BUSINESS_EMAIL_NOT_FOUND',
  'BUSINESS_EMAIL_UNCERTAIN',
  'INACTIVE',
  'AMBIGUOUS',
  'BOUNCE',
  'OPT_OUT',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'BLOCKED',
  'COMPLAINT',
  'AUDIT_FAILURE',
  'SCORE_BELOW_THRESHOLD',
  'OTHER',
] as const;

export type ProspectingRejectionReason = (typeof prospectingRejectionReasons)[number];

export const structuralRejectionReasons = [
  'PREVIOUS_CONTACT',
  'DUPLICATE',
  'OFFICIAL_SITE',
  'BUSINESS_EMAIL_NOT_FOUND',
  'BUSINESS_EMAIL_UNCERTAIN',
  'INACTIVE',
  'AMBIGUOUS',
] as const satisfies readonly ProspectingRejectionReason[];

const safetyRejectionReasons = [
  'BOUNCE',
  'OPT_OUT',
  'DO_NOT_CONTACT',
  'NAO_CONTATAR',
  'BLOCKED',
  'COMPLAINT',
  'AUDIT_FAILURE',
] as const satisfies readonly ProspectingRejectionReason[];

export type RejectionReasonCounts = Partial<Record<ProspectingRejectionReason, number>>;

export interface ProspectingCityRunMetricsInput {
  city: ProspectingCity;
  found: number;
  approved: number;
  rejected: number;
  sentAcceptedByProvider: number;
  immediateBounces: number;
  optOuts: number;
  replies: number;
  complaints: number;
  blocked: number;
  duplicatesAvoided: number;
  rejectionReasons: RejectionReasonCounts;
  scoreDistribution: {
    score0To59: number;
    score60To79: number;
    score80To99: number;
    score100: number;
  };
}

export interface ProspectingCityRunMetrics extends ProspectingCityRunMetricsInput {
  approvalRate: number;
  rejectionRate: number;
  sendRateAmongApproved: number;
}

export interface CitySaturationInput {
  city: ProspectingCity;
  found: number;
  approved: number;
  rejectionReasons: RejectionReasonCounts;
  consecutiveLowYieldRuns?: number;
  auditFailure?: boolean;
  ambiguousResult?: boolean;
}

export interface CitySaturationResult {
  saturationIndex: number;
  structuralRejected: number;
  structuralRejectionRate: number;
  structuralPredominant: boolean;
  lowYield: boolean;
  shouldAdvance: boolean;
  reasons: string[];
}

export type CityTransitionRunInput = Pick<CitySaturationInput, 'found' | 'approved' | 'rejectionReasons' | 'auditFailure' | 'ambiguousResult'>;

export interface CityTransitionInput {
  currentCity: ProspectingCity;
  recentRuns: readonly CityTransitionRunInput[];
}

export interface CityTransitionResult {
  action: 'STAY' | 'ADVANCE' | 'COMPLETE';
  currentCity: ProspectingCity;
  nextCity: ProspectingCity | null;
  consecutiveLowYieldRuns: number;
  reasonCodes: string[];
}

const cityIndexes = new Map<ProspectingCity, number>(prospectingCities.map((city, index) => [city, index]));
const isCity = (value: unknown): value is ProspectingCity => typeof value === 'string' && cityIndexes.has(value as ProspectingCity);

function assertCity(city: unknown): asserts city is ProspectingCity {
  if (!isCity(city)) throw new RangeError('city must be one of the configured prospecting cities');
}

export function getNextProspectingCity(city: ProspectingCity): ProspectingCity | null {
  assertCity(city);
  const index = cityIndexes.get(city)!;
  return index < prospectingCities.length - 1 ? prospectingCities[index + 1]! : null;
}

export function assertMonotonicCityTransition(fromCity: ProspectingCity, toCity: ProspectingCity): void {
  assertCity(fromCity);
  assertCity(toCity);
  const fromIndex = cityIndexes.get(fromCity)!;
  const toIndex = cityIndexes.get(toCity)!;
  if (toIndex !== fromIndex + 1) throw new RangeError('city transition must advance exactly one position');
}

const assertNonNegativeInteger = (field: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative integer`);
};

const rate = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

export function normalizeProspectingRejectionReasons(input: RejectionReasonCounts): Record<ProspectingRejectionReason, number> {
  const normalized = Object.fromEntries(prospectingRejectionReasons.map((reason) => [reason, 0])) as Record<ProspectingRejectionReason, number>;
  for (const [reason, value] of Object.entries(input ?? {})) {
    if (!(prospectingRejectionReasons as readonly string[]).includes(reason)) {
      throw new RangeError('rejectionReasons contains an unknown reason');
    }
    assertNonNegativeInteger(`rejectionReasons.${reason}`, value);
    normalized[reason as ProspectingRejectionReason] = value;
  }
  return normalized;
}

export function buildProspectingCityRunMetrics(input: ProspectingCityRunMetricsInput): ProspectingCityRunMetrics {
  assertCity(input.city);
  const countFields = [
    'found', 'approved', 'rejected', 'sentAcceptedByProvider', 'immediateBounces', 'optOuts', 'replies',
    'complaints', 'blocked', 'duplicatesAvoided',
  ] as const;
  for (const field of countFields) {
    assertNonNegativeInteger(field, input[field]);
  }
  for (const field of ['score0To59', 'score60To79', 'score80To99', 'score100'] as const) {
    assertNonNegativeInteger(field, input.scoreDistribution[field]);
  }
  if (input.approved + input.rejected > input.found) throw new RangeError('approved plus rejected cannot exceed found');
  if (input.sentAcceptedByProvider > input.approved) throw new RangeError('sentAcceptedByProvider cannot exceed approved');
  const scoreTotal = Object.values(input.scoreDistribution).reduce((sum, value) => sum + value, 0);
  if (scoreTotal !== input.found) throw new RangeError('scoreDistribution must sum to found');
  const rejectionReasons = normalizeProspectingRejectionReasons(input.rejectionReasons);
  return {
    ...input,
    rejectionReasons,
    approvalRate: rate(input.approved, input.found),
    rejectionRate: rate(input.rejected, input.found),
    sendRateAmongApproved: rate(input.sentAcceptedByProvider, input.approved),
  };
}

export function calculateCitySaturation(input: CitySaturationInput): CitySaturationResult {
  assertCity(input.city);
  assertNonNegativeInteger('found', input.found);
  assertNonNegativeInteger('approved', input.approved);
  if (input.approved > input.found) throw new RangeError('approved cannot exceed found');
  const consecutiveLowYieldRuns = input.consecutiveLowYieldRuns ?? 0;
  assertNonNegativeInteger('consecutiveLowYieldRuns', consecutiveLowYieldRuns);
  const reasons = normalizeProspectingRejectionReasons(input.rejectionReasons);
  const structuralRejected = structuralRejectionReasons.reduce((sum, reason) => sum + reasons[reason], 0);
  const safetyRejected = safetyRejectionReasons.reduce((sum, reason) => sum + reasons[reason], 0);
  const structuralRejectionRate = rate(structuralRejected, input.found);
  const lowYield = input.approved <= 2;
  const structuralPredominant = structuralRejected > safetyRejected;
  const hasAuditFailure = input.auditFailure === true || reasons.AUDIT_FAILURE > 0;
  const hasAmbiguousResult = input.ambiguousResult === true || reasons.AMBIGUOUS > 0;
  const saturationIndex = Math.max(0, Math.min(100, structuralRejectionRate * 70 + (lowYield ? 30 : 0)));
  const reasonsOut: string[] = [];
  if (lowYield) reasonsOut.push('LOW_YIELD');
  if (structuralPredominant) reasonsOut.push('STRUCTURAL_REJECTIONS_PREDOMINANT');
  if (saturationIndex >= 70) reasonsOut.push('SATURATION_THRESHOLD_REACHED');
  if (hasAuditFailure) reasonsOut.push('AUDIT_FAILURE');
  if (hasAmbiguousResult) reasonsOut.push('AMBIGUOUS_RESULT');
  if (input.city === 'Indaiatuba') reasonsOut.push('FINAL_CITY');
  return {
    saturationIndex,
    structuralRejected,
    structuralRejectionRate,
    structuralPredominant,
    lowYield,
    shouldAdvance: consecutiveLowYieldRuns >= 2
      && lowYield
      && structuralPredominant
      && saturationIndex >= 70
      && !hasAuditFailure
      && !hasAmbiguousResult
      && input.city !== 'Indaiatuba',
    reasons: reasonsOut,
  };
}

export function evaluateCityTransition(input: CityTransitionInput): CityTransitionResult {
  assertCity(input.currentCity);
  if (input.currentCity === 'Indaiatuba') {
    return { action: 'COMPLETE', currentCity: input.currentCity, nextCity: null, consecutiveLowYieldRuns: 0, reasonCodes: ['FINAL_CITY_COMPLETE'] };
  }
  const runs = input.recentRuns.map((run) => {
    const result = calculateCitySaturation({ ...run, city: input.currentCity, consecutiveLowYieldRuns: 2 });
    return { run, result };
  });
  let consecutiveLowYieldRuns = 0;
  for (let index = runs.length - 1; index >= 0 && runs[index]!.result.lowYield; index -= 1) consecutiveLowYieldRuns += 1;
  const recent = runs.slice(-2);
  const reasonCodes: string[] = [];
  if (recent.length < 2) reasonCodes.push('INSUFFICIENT_CONSECUTIVE_RUNS');
  const qualifies = recent.length === 2 && recent.every(({ result }) => result.shouldAdvance);
  if (!qualifies) {
    if (recent.some(({ result }) => result.lowYield) && !recent.every(({ result }) => result.structuralPredominant)) {
      reasonCodes.push('STRUCTURAL_REJECTIONS_NOT_PREDOMINANT');
    }
    if (recent.some(({ result }) => result.saturationIndex < 70)) reasonCodes.push('SATURATION_THRESHOLD_NOT_REACHED');
    if (recent.some(({ result }) => result.reasons.includes('AUDIT_FAILURE'))) reasonCodes.push('AUDIT_FAILURE');
    if (recent.some(({ result }) => result.reasons.includes('AMBIGUOUS_RESULT'))) reasonCodes.push('AMBIGUOUS_RESULT');
  }
  const nextCity = getNextProspectingCity(input.currentCity);
  if (!qualifies) return { action: 'STAY', currentCity: input.currentCity, nextCity, consecutiveLowYieldRuns, reasonCodes };
  if (!nextCity) return { action: 'COMPLETE', currentCity: input.currentCity, nextCity: null, consecutiveLowYieldRuns, reasonCodes: ['FINAL_CITY_COMPLETE'] };
  return { action: 'ADVANCE', currentCity: input.currentCity, nextCity, consecutiveLowYieldRuns, reasonCodes: ['TWO_CONSECUTIVE_LOW_YIELD_STRUCTURAL_RUNS'] };
}
