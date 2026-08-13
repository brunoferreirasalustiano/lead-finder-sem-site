import { describe, expect, it } from 'vitest';
import { safeCnpjWsPublicRpm } from './provider-policy.js';

describe('provider operational pacing policy', () => {
  it('keeps CNPJ.ws below the documented public ceiling', () => {
    expect(safeCnpjWsPublicRpm(3)).toBe(2);
    expect(safeCnpjWsPublicRpm(10)).toBe(2);
  });

  it('preserves a stricter caller-supplied limit', () => {
    expect(safeCnpjWsPublicRpm(2)).toBe(2);
    expect(safeCnpjWsPublicRpm(1)).toBe(1);
  });
});
