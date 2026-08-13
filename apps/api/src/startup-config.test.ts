import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { hmlDaily6AuthPermissions, hmlDiscoveryAuthPermissions } from '@lead-finder/shared';
import { installAuthorization } from './auth.js';
import { parseApiStartupConfig } from './startup-config.js';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('API startup configuration with expired dedicated HML authentication', () => {
  it('keeps expired discovery and Daily-6 credentials unusable without blocking API configuration', async () => {
    const discoveryToken = 'expired-discovery-token-for-startup-test-000000000000000000000001';
    const daily6Token = 'expired-daily6-token-for-startup-test-0000000000000000000000001';
    const expiredAt = '2000-01-01T00:00:00.000Z';
    const config = parseApiStartupConfig({
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/synthetic',
      API_AUTH_TOKEN: 'synthetic-api-token-for-startup-config-test-0001',
      API_AUTH_PERMISSIONS: 'pilot:read',
      DEPLOYMENT_PROFILE: 'supabase-render',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      SHADOW_MODE_ENABLED: 'true',
      INTERNAL_CRON_SECRET: 'synthetic-internal-cron-secret-00000001',
      COLLECTION_EGRESS_ENABLED: 'true',
      OVERPASS_API_URL: 'https://overpass-api.de/api/interpreter',
      HML_DISCOVERY_AUTH_ENABLED: 'true',
      HML_DISCOVERY_AUTH_TOKEN_HASH: sha256(discoveryToken),
      HML_DISCOVERY_AUTH_EXPIRES_AT: expiredAt,
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-discovery-startup-test',
      HML_DAILY6_AUTH_ENABLED: 'true',
      HML_DAILY6_AUTH_TOKEN_HASH: sha256(daily6Token),
      HML_DAILY6_AUTH_EXPIRES_AT: expiredAt,
      HML_DAILY6_AUTH_PRINCIPAL_ID: 'hml-daily6-startup-test',
    });

    expect(config.HML_DISCOVERY_AUTH_EXPIRES_AT?.toISOString()).toBe(expiredAt);
    expect(config.HML_DAILY6_AUTH_EXPIRES_AT?.toISOString()).toBe(expiredAt);

    const app = Fastify({ logger: false });
    installAuthorization(app, {
      discoveryTemporary: {
        tokenHash: config.HML_DISCOVERY_AUTH_TOKEN_HASH!,
        expiresAt: config.HML_DISCOVERY_AUTH_EXPIRES_AT!,
        principalId: config.HML_DISCOVERY_AUTH_PRINCIPAL_ID!,
        principalPermissions: hmlDiscoveryAuthPermissions,
        environment: 'homologation',
      },
      daily6Temporary: {
        tokenHash: config.HML_DAILY6_AUTH_TOKEN_HASH!,
        expiresAt: config.HML_DAILY6_AUTH_EXPIRES_AT!,
        principalId: config.HML_DAILY6_AUTH_PRINCIPAL_ID!,
        principalPermissions: hmlDaily6AuthPermissions,
        environment: 'homologation',
      },
    });
    app.post('/collect', () => ({ unsafe: true }));
    app.post('/internal/daily6/run-slot', () => ({ unsafe: true }));
    await app.ready();

    expect((await app.inject({
      method: 'POST',
      url: '/collect',
      headers: { authorization: `Bearer ${discoveryToken}` },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST',
      url: '/internal/daily6/run-slot',
      headers: { authorization: `Bearer ${daily6Token}` },
    })).statusCode).toBe(401);

    await app.close();
  });

  it.each([
    'not-a-date',
    '2000-01-01',
    'Sat, 01 Jan 2000 00:00:00 GMT',
  ])('still rejects malformed dedicated expiry configuration: %s', (expiry) => {
    expect(() => parseApiStartupConfig({
      DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/synthetic',
      API_AUTH_TOKEN: 'synthetic-api-token-for-startup-config-test-0001',
      API_AUTH_PERMISSIONS: 'pilot:read',
      DEPLOYMENT_ENVIRONMENT: 'homologation',
      HML_DISCOVERY_AUTH_ENABLED: 'true',
      HML_DISCOVERY_AUTH_TOKEN_HASH: 'a'.repeat(64),
      HML_DISCOVERY_AUTH_EXPIRES_AT: expiry,
      HML_DISCOVERY_AUTH_PRINCIPAL_ID: 'hml-discovery-startup-test',
    })).toThrow('HML_DISCOVERY_AUTH_EXPIRES_AT');
  });
});
