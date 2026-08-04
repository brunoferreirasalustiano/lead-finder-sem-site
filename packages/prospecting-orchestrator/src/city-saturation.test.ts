import { describe, expect, it } from 'vitest';
import {
  assertMonotonicCityTransition,
  calculateCitySaturation,
  evaluateCityTransition,
  type CityTransitionRunInput,
  type RejectionReasonCounts,
} from './city-saturation.js';

const structuralReasons: RejectionReasonCounts = {
  PREVIOUS_CONTACT: 3,
  OFFICIAL_SITE: 3,
  BUSINESS_EMAIL_NOT_FOUND: 2,
};

const lowStructuralRun = (overrides: Partial<CityTransitionRunInput> = {}): CityTransitionRunInput => ({
  found: 10,
  approved: 2,
  rejectionReasons: structuralReasons,
  ...overrides,
});

describe('city saturation', () => {
  it('returns zero saturation for an empty run without structural evidence', () => {
    expect(calculateCitySaturation({ city: 'Campinas', found: 0, approved: 0, rejectionReasons: {} })).toMatchObject({
      saturationIndex: 30,
      structuralRejectionRate: 0,
      lowYield: true,
      shouldAdvance: false,
    });
  });

  it('reaches the maximum saturation after structural rejection evidence', () => {
    const result = calculateCitySaturation({
      city: 'Campinas', found: 10, approved: 0,
      rejectionReasons: { PREVIOUS_CONTACT: 10, OFFICIAL_SITE: 10 }, consecutiveLowYieldRuns: 2,
    });
    expect(result.saturationIndex).toBe(100);
    expect(result.shouldAdvance).toBe(true);
  });

  it('recognizes approved counts of two as low yield and three as non-low-yield', () => {
    expect(calculateCitySaturation({ city: 'Campinas', found: 3, approved: 2, rejectionReasons: {} }).lowYield).toBe(true);
    expect(calculateCitySaturation({ city: 'Campinas', found: 3, approved: 3, rejectionReasons: {} }).lowYield).toBe(false);
  });

  it('requires non-negative and coherent counters', () => {
    expect(() => calculateCitySaturation({ city: 'Campinas', found: -1, approved: 0, rejectionReasons: {} })).toThrow(RangeError);
    expect(() => calculateCitySaturation({ city: 'Campinas', found: 1, approved: 2, rejectionReasons: {} })).toThrow(RangeError);
    expect(() => calculateCitySaturation({ city: 'Campinas', found: 1, approved: 0, rejectionReasons: { OTHER: -1 } })).toThrow(RangeError);
  });

  it('does not interpret safety suppression as market saturation', () => {
    const result = calculateCitySaturation({
      city: 'Campinas', found: 10, approved: 0,
      rejectionReasons: { OPT_OUT: 10, BOUNCE: 2 }, consecutiveLowYieldRuns: 2,
    });
    expect(result.saturationIndex).toBe(30);
    expect(result.structuralPredominant).toBe(false);
    expect(result.shouldAdvance).toBe(false);
  });

  it('requires two consecutive structural low-yield runs before advancing', () => {
    expect(evaluateCityTransition({ currentCity: 'Campinas', recentRuns: [lowStructuralRun()] }).action).toBe('STAY');
    expect(evaluateCityTransition({ currentCity: 'Campinas', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({
      action: 'ADVANCE', nextCity: 'Valinhos', consecutiveLowYieldRuns: 2,
    });
  });

  it('blocks advancement after audit failure or ambiguity', () => {
    expect(evaluateCityTransition({ currentCity: 'Campinas', recentRuns: [
      lowStructuralRun(), lowStructuralRun({ auditFailure: true }),
    ] }).action).toBe('STAY');
    expect(evaluateCityTransition({ currentCity: 'Campinas', recentRuns: [
      lowStructuralRun(), lowStructuralRun({ ambiguousResult: true }),
    ] }).action).toBe('STAY');
  });

  it('follows the fixed city order and completes at Indaiatuba', () => {
    expect(evaluateCityTransition({ currentCity: 'Valinhos', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({ action: 'ADVANCE', nextCity: 'Paulínia' });
    expect(evaluateCityTransition({ currentCity: 'Paulínia', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({ action: 'ADVANCE', nextCity: 'Hortolândia' });
    expect(evaluateCityTransition({ currentCity: 'Hortolândia', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({ action: 'ADVANCE', nextCity: 'Sumaré' });
    expect(evaluateCityTransition({ currentCity: 'Sumaré', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({ action: 'ADVANCE', nextCity: 'Indaiatuba' });
    expect(evaluateCityTransition({ currentCity: 'Indaiatuba', recentRuns: [lowStructuralRun(), lowStructuralRun()] })).toMatchObject({ action: 'COMPLETE', nextCity: null });
  });

  it('rejects regression and skipped-city transitions', () => {
    expect(() => assertMonotonicCityTransition('Valinhos', 'Campinas')).toThrow(RangeError);
    expect(() => assertMonotonicCityTransition('Campinas', 'Paulínia')).toThrow(RangeError);
    expect(() => assertMonotonicCityTransition('Indaiatuba', 'Campinas')).toThrow(RangeError);
  });

  it('does not expose PII in saturation output', () => {
    const serialized = JSON.stringify(calculateCitySaturation({ city: 'Campinas', found: 10, approved: 1, rejectionReasons: { OTHER: 9 } }));
    expect(serialized).not.toMatch(/@|\+?\d[\d ()-]{7,}|email|phone|name/i);
  });
});
