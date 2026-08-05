import { describe, expect, it } from 'vitest';
import { buildProspectingRunMetrics, scoreBands, type ProspectingRunMetricsInput } from './metrics.js';

const baseMetrics: ProspectingRunMetricsInput = {
  city: 'Campinas',
  found: 10,
  approved: 4,
  rejected: 6,
  sentAcceptedByProvider: 2,
  immediateBounces: 1,
  optOuts: 1,
  replies: 1,
  complaints: 0,
  blocked: 2,
  duplicatesAvoided: 3,
  officialDomainsFound: 2,
  missingBusinessEmails: 4,
  inactiveOrUncertain: 1,
  ambiguousResults: 1,
  scoreDistribution: { '0-19': 1, '20-39': 2, '40-59': 2, '60-79': 1, '80-100': 4 },
};

describe('prospecting run metrics', () => {
  it('calculates approval and provider-acceptance rates', () => {
    const result = buildProspectingRunMetrics(baseMetrics);
    expect(result.approvalRate).toBe(0.4);
    expect(result.sendRateAmongApproved).toBe(0.5);
    expect(result.sentAcceptedByProvider).toBe(2);
  });

  it('returns zero rates when found or approved is zero', () => {
    const emptyRun = {
      ...baseMetrics,
      found: 0,
      approved: 0,
      rejected: 0,
      sentAcceptedByProvider: 0,
    };
    delete emptyRun.scoreDistribution;
    expect(buildProspectingRunMetrics(emptyRun)).toMatchObject({ approvalRate: 0, sendRateAmongApproved: 0 });
    expect(buildProspectingRunMetrics({ ...baseMetrics, approved: 0, rejected: 10, sentAcceptedByProvider: 0 })).toMatchObject({ approvalRate: 0, sendRateAmongApproved: 0 });
  });

  it('returns a complete and consistent score distribution', () => {
    const result = buildProspectingRunMetrics(baseMetrics);
    expect(Object.keys(result.scoreDistribution)).toEqual(scoreBands);
    expect(Object.values(result.scoreDistribution).reduce((sum, value) => sum + value, 0)).toBe(result.found);
  });

  it('does not expose contact fields or other PII in its output', () => {
    const result = buildProspectingRunMetrics(baseMetrics);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/@|\+?\d[\d ()-]{7,}/u);
    expect(Object.keys(result)).not.toContain('email');
    expect(Object.keys(result)).not.toContain('phone');
    expect(Object.keys(result)).not.toContain('name');
  });

  it('rejects invalid counts, city labels, and inconsistent distributions', () => {
    expect(() => buildProspectingRunMetrics({ ...baseMetrics, found: -1 })).toThrow(RangeError);
    expect(() => buildProspectingRunMetrics({ ...baseMetrics, city: '   ' })).toThrow(RangeError);
    expect(() => buildProspectingRunMetrics({ ...baseMetrics, scoreDistribution: { '0-19': 1 } })).toThrow(RangeError);
  });

  it('rejects aggregate counts that cannot describe a coherent run', () => {
    expect(() => buildProspectingRunMetrics({
      ...baseMetrics,
      found: 1,
      approved: 1,
      rejected: 1,
      sentAcceptedByProvider: 1,
      scoreDistribution: { '80-100': 1 },
    })).toThrow('approved plus rejected cannot exceed found');

    expect(() => buildProspectingRunMetrics({
      ...baseMetrics,
      approved: 1,
      rejected: 9,
      sentAcceptedByProvider: 2,
    })).toThrow('sentAcceptedByProvider cannot exceed approved');
  });
});
