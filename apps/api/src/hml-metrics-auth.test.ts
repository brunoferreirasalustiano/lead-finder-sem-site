import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmlMetricsAuthPermissions, parseHmlMetricsAuthentication } from './hml-metrics-auth.js';

const now = new Date('2026-08-05T12:00:00.000Z');
const apiAuthToken = 'synthetic-api-auth-token-for-metrics-tests-0001';
const tokenHash = 'a'.repeat(64);
const validEnvironment = {
  HML_METRICS_AUTH_ENABLED: 'true',
  HML_METRICS_AUTH_TOKEN_HASH: tokenHash,
  HML_METRICS_AUTH_EXPIRES_AT: '2026-08-05T12:30:00.000Z',
  HML_METRICS_AUTH_PRINCIPAL_ID: 'hml-metrics-read-test',
};
const conflicts = {
  deploymentEnvironment: 'homologation' as const,
  apiAuthToken,
  smokeTokenHash: 'b'.repeat(64),
  operatorTokenHash: 'c'.repeat(64),
  smokePrincipalId: 'hml-smoke-test',
  operatorPrincipalId: 'hml-metrics-existing-operator',
  now,
};

describe('HML metrics authentication configuration', () => {
  it('is disabled by default and rejects hidden partial configuration', () => {
    expect(parseHmlMetricsAuthentication({}, conflicts)).toBeUndefined();
    expect(parseHmlMetricsAuthentication({ HML_METRICS_AUTH_ENABLED: 'false' }, conflicts)).toBeUndefined();
    expect(() => parseHmlMetricsAuthentication({
      HML_METRICS_AUTH_TOKEN_HASH: tokenHash,
    }, conflicts)).toThrow('HML_METRICS_AUTH_ENABLED=true');
    expect(() => parseHmlMetricsAuthentication({
      HML_METRICS_AUTH_ENABLED: 'yes',
    }, conflicts)).toThrow('must be true or false');
  });

  it('returns one fixed read-only permission for a valid time-bounded principal', () => {
    const parsed = parseHmlMetricsAuthentication(validEnvironment, conflicts);
    expect(parsed).toEqual({
      tokenHash,
      expiresAt: new Date(validEnvironment.HML_METRICS_AUTH_EXPIRES_AT),
      principalId: 'hml-metrics-read-test',
      principalPermissions: hmlMetricsAuthPermissions,
      environment: 'homologation',
    });
    expect(parsed?.principalPermissions).toEqual(['prospecting:metrics:read']);
  });

  it('rejects non-homologation, expired, or excessive lifetimes', () => {
    expect(() => parseHmlMetricsAuthentication(validEnvironment, {
      ...conflicts,
      deploymentEnvironment: 'production',
    })).toThrow('only in homologation');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_EXPIRES_AT: '2026-08-05T11:59:59.000Z',
    }, conflicts)).toThrow('must be in the future');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_EXPIRES_AT: '2026-08-05T13:00:00.001Z',
    }, conflicts)).toThrow('within one hour');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_EXPIRES_AT: '2026-08-05 12:30:00',
    }, conflicts)).toThrow('ISO-8601');
  });

  it('rejects malformed hashes and principal identifiers', () => {
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_TOKEN_HASH: 'not-a-hash',
    }, conflicts)).toThrow('SHA-256');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_PRINCIPAL_ID: 'hml-operator',
    }, conflicts)).toThrow('hml-metrics-');
  });

  it('rejects token and principal reuse across authentication domains', () => {
    const apiTokenHash = createHash('sha256').update(apiAuthToken, 'utf8').digest('hex');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_TOKEN_HASH: apiTokenHash,
    }, conflicts)).toThrow('must differ from existing authentication tokens');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_TOKEN_HASH: conflicts.smokeTokenHash,
    }, conflicts)).toThrow('must differ from existing authentication tokens');
    expect(() => parseHmlMetricsAuthentication({
      ...validEnvironment,
      HML_METRICS_AUTH_PRINCIPAL_ID: conflicts.operatorPrincipalId,
    }, conflicts)).toThrow('must differ from existing principals');
  });
});
