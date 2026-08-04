export const scoreBands = ['0-19', '20-39', '40-59', '60-79', '80-100'] as const;
export type ScoreBand = (typeof scoreBands)[number];
export type ScoreDistribution = Readonly<Record<ScoreBand, number>>;

export interface ProspectingRunMetricsInput {
  city: string;
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
  officialDomainsFound: number;
  missingBusinessEmails: number;
  inactiveOrUncertain: number;
  ambiguousResults: number;
  scoreDistribution?: Partial<ScoreDistribution>;
}

export interface ProspectingRunMetrics extends Omit<ProspectingRunMetricsInput, 'scoreDistribution'> {
  scoreDistribution: ScoreDistribution;
  approvalRate: number;
  sendRateAmongApproved: number;
}

const emptyScoreDistribution = (): Record<ScoreBand, number> => ({
  '0-19': 0,
  '20-39': 0,
  '40-59': 0,
  '60-79': 0,
  '80-100': 0,
});

const assertNonNegativeInteger = (field: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative integer`);
};

const assertCity = (city: string): string => {
  const normalized = city.trim();
  const containsControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
  if (normalized.length === 0 || normalized.length > 120 || containsControlCharacter) {
    throw new RangeError('city must be a non-empty safe label');
  }
  return normalized;
};

function normalizeScoreDistribution(input: Partial<ScoreDistribution> | undefined, found: number): ScoreDistribution {
  const distribution = emptyScoreDistribution();
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!(scoreBands as readonly string[]).includes(key)) throw new TypeError('scoreDistribution contains an unknown score band');
    assertNonNegativeInteger(`scoreDistribution.${key}`, value);
    distribution[key as ScoreBand] = value;
  }
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (total !== found) throw new RangeError('scoreDistribution must sum to found');
  return distribution;
}

const rate = (numerator: number, denominator: number): number => (denominator === 0 ? 0 : numerator / denominator);

export function buildProspectingRunMetrics(input: ProspectingRunMetricsInput): ProspectingRunMetrics {
  const countFields = [
    'found', 'approved', 'rejected', 'sentAcceptedByProvider', 'immediateBounces', 'optOuts', 'replies',
    'complaints', 'blocked', 'duplicatesAvoided', 'officialDomainsFound', 'missingBusinessEmails',
    'inactiveOrUncertain', 'ambiguousResults',
  ] as const;
  for (const field of countFields) assertNonNegativeInteger(field, input[field]);
  const city = assertCity(input.city);
  const scoreDistribution = normalizeScoreDistribution(input.scoreDistribution, input.found);

  return {
    city,
    found: input.found,
    approved: input.approved,
    rejected: input.rejected,
    sentAcceptedByProvider: input.sentAcceptedByProvider,
    immediateBounces: input.immediateBounces,
    optOuts: input.optOuts,
    replies: input.replies,
    complaints: input.complaints,
    blocked: input.blocked,
    duplicatesAvoided: input.duplicatesAvoided,
    officialDomainsFound: input.officialDomainsFound,
    missingBusinessEmails: input.missingBusinessEmails,
    inactiveOrUncertain: input.inactiveOrUncertain,
    ambiguousResults: input.ambiguousResults,
    scoreDistribution,
    approvalRate: rate(input.approved, input.found),
    sendRateAmongApproved: rate(input.sentAcceptedByProvider, input.approved),
  };
}
