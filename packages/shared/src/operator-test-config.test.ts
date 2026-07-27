import { describe, expect, it } from 'vitest';
import { parseApiConfig } from './config.js';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://leadfinder:secret@localhost:5432/leadfinder',
  API_AUTH_TOKEN: 'operator-test-api-token-000000000001',
  API_AUTH_PERMISSIONS: 'pilot:read',
};
const syntheticPhone = '+12025550100';
const fingerprintKey = 'operator-test-fingerprint-key-0001';
const bindingKey = 'operator-test-recipient-binding-key-0001';

const errorMessage = (environment: NodeJS.ProcessEnv) => {
  try {
    parseApiConfig(environment);
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error('Expected configuration error');
};

describe('operator test API configuration', () => {
  it('is disabled with a dedicated kill switch engaged by default', () => {
    const config = parseApiConfig(baseEnvironment);
    expect(config.OPERATOR_TEST_ENABLED).toBe(false);
    expect(config.OPERATOR_TEST_KILL_SWITCH_ENABLED).toBe(true);
    expect(config.OPERATOR_TEST_WHATSAPP_E164).toBeUndefined();
    expect(config.OPERATOR_TEST_FINGERPRINT_KEY).toBeUndefined();
    expect(config.OPERATOR_TEST_RECIPIENT_BINDING_KEY).toBeUndefined();
  });

  it('rejects partially configured private values while disabled', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
    })).toContain('OPERATOR_TEST_ENABLED must be true');
  });

  it('requires the authorized number, fingerprint key, and binding key when enabled', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    })).toContain('OPERATOR_TEST_FINGERPRINT_KEY is required');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    })).toContain('OPERATOR_TEST_WHATSAPP_E164 is required');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
    })).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY is required');
  });

  it('rejects an invalid phone or a short fingerprint key', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '2025550100',
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    })).toContain('must use E.164 format');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: 'short',
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    })).toContain('OPERATOR_TEST_FINGERPRINT_KEY');
  });

  it('rejects malformed, reused, or isolated binding keys', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    })).toContain('OPERATOR_TEST_ENABLED must be true');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: 'short',
    })).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: baseEnvironment.API_AUTH_TOKEN,
    })).toContain('must differ from API_AUTH_TOKEN');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: fingerprintKey,
    })).toContain('must differ from OPERATOR_TEST_FINGERPRINT_KEY');
  });

  it('accepts only explicitly configured operator test permissions', () => {
    const config = parseApiConfig({
      ...baseEnvironment,
      API_AUTH_PERMISSIONS: 'operator-test:prepare,operator-test:open,operator-test:confirm,operator-test:response',
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_KILL_SWITCH_ENABLED: 'false',
      OPERATOR_TEST_WHATSAPP_E164: syntheticPhone,
      OPERATOR_TEST_FINGERPRINT_KEY: fingerprintKey,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
    });
    expect(config.API_AUTH_PERMISSIONS).toEqual([
      'operator-test:prepare',
      'operator-test:open',
      'operator-test:confirm',
      'operator-test:response',
    ]);
    expect(config.OPERATOR_TEST_ENABLED).toBe(true);
    expect(config.OPERATOR_TEST_KILL_SWITCH_ENABLED).toBe(false);
    expect(config.OPERATOR_TEST_RECIPIENT_BINDING_KEY).toBe(bindingKey);
  });
});
