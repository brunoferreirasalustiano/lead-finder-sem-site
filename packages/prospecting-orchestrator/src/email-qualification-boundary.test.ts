import { describe, expect, it } from 'vitest';
import {
  classifyTechnicalEmail,
  evaluateTechnicalEmail,
  type TechnicalEmailEvaluationInput,
} from './email-qualification.js';

const validInput: TechnicalEmailEvaluationInput = {
  email: 'contato@example.com',
  domainResolution: { domainExists: 'YES', mx: 'PRESENT' },
  publicBusinessProvenance: 'CONFIRMED',
  suppression: {
    hardBounce: false,
    optOut: false,
    complaint: false,
    doNotContact: false,
    naoContatar: false,
    blocked: false,
  },
};

describe('technical email external input boundary', () => {
  it.each([null, undefined, 'invalid', 42, true, [], ['invalid']])(
    'fails closed without throwing for malformed top-level input: %s',
    (input) => {
      expect(() => classifyTechnicalEmail(input)).not.toThrow();
      expect(classifyTechnicalEmail(input)).toEqual({
        state: 'UNCERTAIN',
        domain: null,
        syntax: 'UNKNOWN',
        domainExists: 'UNKNOWN',
        mx: 'UNKNOWN',
        publicBusinessProvenance: 'UNKNOWN',
        blockedBy: [],
        reason: 'INVALID_INPUT',
      });
    },
  );

  it.each([null, 'invalid', 42, []])(
    'fails closed asynchronously without invoking the resolver: %s',
    async (input) => {
      let calls = 0;
      const result = await evaluateTechnicalEmail(input, {
        resolve: () => {
          calls += 1;
          return Promise.resolve({ domainExists: 'YES', mx: 'PRESENT' });
        },
      });
      expect(result.reason).toBe('INVALID_INPUT');
      expect(result.state).toBe('UNCERTAIN');
      expect(calls).toBe(0);
    },
  );

  it('accepts only DNS uncertainty reasons in the public classifier contract', () => {
    expect(classifyTechnicalEmail(validInput, 'DNS_TIMEOUT')).toMatchObject({
      state: 'UNCERTAIN',
      reason: 'DNS_TIMEOUT',
    });

    // @ts-expect-error Resolver issues must never carry success, suppression, or syntax reasons.
    classifyTechnicalEmail(validInput, 'VALIDATED');
  });
});
