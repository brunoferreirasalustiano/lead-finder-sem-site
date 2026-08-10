import { describe, expect, it } from 'vitest';
import {
  classifyOperatorEmailProviderFailure,
  operatorEmailProviderFailureDisposition,
} from './operator-email-test.js';

describe('operator email provider failure disposition', () => {
  it.each([
    ['TOKEN_EXCHANGE_FAILED', 'FAILED'],
    ['DELIVERY_REJECTED', 'FAILED'],
    ['INVALID_CONFIGURATION', 'FAILED'],
    ['DELIVERY_AMBIGUOUS', 'AMBIGUOUS'],
  ] as const)('maps %s to %s', (code, disposition) => {
    const failureClass = classifyOperatorEmailProviderFailure({ code });
    expect(failureClass).toBe(code);
    expect(operatorEmailProviderFailureDisposition(failureClass)).toBe(disposition);
  });

  it('fails closed for unknown delivery failures', () => {
    const failureClass = classifyOperatorEmailProviderFailure(new Error('synthetic'));
    expect(failureClass).toBe('UNKNOWN');
    expect(operatorEmailProviderFailureDisposition(failureClass)).toBe('AMBIGUOUS');
  });

  it('does not accept arbitrary external codes as trusted classifications', () => {
    const failureClass = classifyOperatorEmailProviderFailure({ code: 'GOOGLE_SECRET_ERROR' });
    expect(failureClass).toBe('UNKNOWN');
    expect(operatorEmailProviderFailureDisposition(failureClass)).toBe('AMBIGUOUS');
  });
});
