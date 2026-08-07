import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmlEmailAuthPermissions, parseHmlEmailAuthentication } from './hml-email-auth.js';

const now = new Date('2026-08-07T20:00:00.000Z');
const apiAuthToken = 'synthetic-api-auth-token-for-email-auth-tests-0001';
const tokenHash = 'a'.repeat(64);
const validEnvironment = {
  HML_EMAIL_AUTH_ENABLED: 'true',
  HML_EMAIL_AUTH_TOKEN_HASH: tokenHash,
  HML_EMAIL_AUTH_EXPIRES_AT: '2026-08-07T20:30:00.000Z',
  HML_EMAIL_AUTH_PRINCIPAL_ID: 'hml-email-operator-test',
};
const conflicts = {
  deploymentEnvironment: 'homologation' as const,
  apiAuthToken,
  smokeTokenHash: 'b'.repeat(64),
  operatorTokenHash: 'c'.repeat(64),
  metricsTokenHash: 'd'.repeat(64),
  smokePrincipalId: 'hml-smoke-test',
  operatorPrincipalId: 'hml-operator-test',
  metricsPrincipalId: 'hml-metrics-test',
  now,
};

// Keep this HML principal intentionally limited to the manual email permission boundary.
describe('HML email authentication configuration', () => {
  it('is disabled by default and rejects partial hidden configuration', () => {
    expect(parseHmlEmailAuthentication({}, conflicts)).toBeUndefined();
    expect(parseHmlEmailAuthentication({ HML_EMAIL_AUTH_ENABLED: 'false' }, conflicts)).toBeUndefined();
    expect(() => parseHmlEmailAuthentication({ HML_EMAIL_AUTH_TOKEN_HASH: tokenHash }, conflicts))
      .toThrow('HML_EMAIL_AUTH_ENABLED=true');
    expect(() => parseHmlEmailAuthentication({ HML_EMAIL_AUTH_ENABLED: 'yes' }, conflicts))
      .toThrow('must be true or false');
  });

  it('returns only the fixed manual email permissions for a valid principal', () => {
    const parsed = parseHmlEmailAuthentication(validEnvironment, conflicts);
    expect(parsed).toEqual({
      tokenHash,
      expiresAt: new Date(validEnvironment.HML_EMAIL_AUTH_EXPIRES_AT),
      principalId: 'hml-email-operator-test',
      principalPermissions: hmlEmailAuthPermissions,
      environment: 'homologation',
    });
    expect(parsed?.principalPermissions).toEqual([
      'manual-messaging:prepare',
      'manual-messaging:open',
      'manual-messaging:send',
      'manual-messaging:cancel',
    ]);
    expect(parsed?.principalPermissions).not.toContain('manual-messaging:cloud-send');
    expect(parsed?.principalPermissions).not.toContain('campaigns:write');
    expect(parsed?.principalPermissions).not.toContain('collection:execute');
  });

  it('rejects non-homologation, expired, excessive, and malformed expirations', () => {
    expect(() => parseHmlEmailAuthentication(validEnvironment, {
      ...conflicts,
      deploymentEnvironment: 'production',
    })).toThrow('only in homologation');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_EXPIRES_AT: '2026-08-07T19:59:59.000Z',
    }, conflicts)).toThrow('must be in the future');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_EXPIRES_AT: '2026-08-07T21:00:00.001Z',
    }, conflicts)).toThrow('within one hour');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_EXPIRES_AT: '2026-08-07 20:30:00',
    }, conflicts)).toThrow('ISO-8601');
  });

  it('rejects malformed hashes and principal identifiers', () => {
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_TOKEN_HASH: 'not-a-hash',
    }, conflicts)).toThrow('SHA-256');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_PRINCIPAL_ID: 'hml-operator',
    }, conflicts)).toThrow('hml-email-');
  });

  it('rejects token and principal reuse across authentication domains', () => {
    const apiTokenHash = createHash('sha256').update(apiAuthToken, 'utf8').digest('hex');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_TOKEN_HASH: apiTokenHash,
    }, conflicts)).toThrow('must differ from existing authentication tokens');
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_TOKEN_HASH: conflicts.metricsTokenHash,
    }, conflicts)).toThrow('must differ from existing authentication tokens');

    const collidingPrincipal = 'hml-email-shared-test';
    expect(() => parseHmlEmailAuthentication({
      ...validEnvironment,
      HML_EMAIL_AUTH_PRINCIPAL_ID: collidingPrincipal,
    }, {
      ...conflicts,
      operatorPrincipalId: collidingPrincipal,
    })).toThrow('must differ from existing principals');
  });
});
