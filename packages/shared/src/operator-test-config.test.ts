import { describe, expect, it } from 'vitest';
import { parseApiConfig } from './config.js';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://leadfinder:secret@localhost:5432/leadfinder',
  API_AUTH_TOKEN: 'operator-test-api-token-000000000001',
  API_AUTH_PERMISSIONS: 'pilot:read',
};

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
  });

  it('rejects partially configured private values while disabled', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_WHATSAPP_E164: '+5511999999999',
    })).toContain('OPERATOR_TEST_ENABLED must be true');
  });

  it('requires both the authorized number and fingerprint key when enabled', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '+5511999999999',
    })).toContain('OPERATOR_TEST_FINGERPRINT_KEY is required');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_FINGERPRINT_KEY: 'operator-test-fingerprint-key-0001',
    })).toContain('OPERATOR_TEST_WHATSAPP_E164 is required');
  });

  it('rejects an invalid phone or a short fingerprint key', () => {
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '11999999999',
      OPERATOR_TEST_FINGERPRINT_KEY: 'operator-test-fingerprint-key-0001',
    })).toContain('must use E.164 format');
    expect(errorMessage({
      ...baseEnvironment,
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '+5511999999999',
      OPERATOR_TEST_FINGERPRINT_KEY: 'short',
    })).toContain('Too small');
  });

  it('accepts only explicitly configured operator test permissions', () => {
    const config = parseApiConfig({
      ...baseEnvironment,
      API_AUTH_PERMISSIONS: 'operator-test:prepare,operator-test:open,operator-test:confirm,operator-test:response',
      OPERATOR_TEST_ENABLED: 'true',
      OPERATOR_TEST_KILL_SWITCH_ENABLED: 'false',
      OPERATOR_TEST_WHATSAPP_E164: '+5511999999999',
      OPERATOR_TEST_FINGERPRINT_KEY: 'operator-test-fingerprint-key-0001',
    });
    expect(config.API_AUTH_PERMISSIONS).toEqual([
      'operator-test:prepare',
      'operator-test:open',
      'operator-test:confirm',
      'operator-test:response',
    ]);
    expect(config.OPERATOR_TEST_ENABLED).toBe(true);
    expect(config.OPERATOR_TEST_KILL_SWITCH_ENABLED).toBe(false);
  });
});
