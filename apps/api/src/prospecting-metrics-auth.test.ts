import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp } from './app.js';

const token = 'synthetic-hml-metrics-read-token-000000000001';
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
const metricsTemporary = {
  tokenHash,
  expiresAt: new Date(Date.now() + 30 * 60_000),
  principalId: 'hml-metrics-read-test',
  principalPermissions: ['prospecting:metrics:read'] as const,
  environment: 'homologation' as const,
};
const authorization = { authorization: `Bearer ${token}` };
const snapshot = {
  currentCity: 'Campinas' as const,
  nextCity: 'Valinhos' as const,
  cities: [],
};

describe('HML metrics-only bearer principal', () => {
  it('authenticates only the dedicated token and remains fail-closed while metrics are disabled', async () => {
    const query = vi.fn().mockResolvedValue(snapshot);
    const app = buildApp({} as Database, {
      authentication: { metricsTemporary },
      contractQueries: { getProspectingCityMetricsSnapshot: query },
    });

    expect((await app.inject({
      method: 'GET',
      url: '/internal/prospecting/city-metrics',
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET',
      url: '/internal/prospecting/city-metrics',
      headers: { authorization: 'Bearer wrong-metrics-token-0000000000000001' },
    })).statusCode).toBe(401);

    const disabled = await app.inject({
      method: 'GET',
      url: '/internal/prospecting/city-metrics',
      headers: authorization,
    });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toEqual({
      error: 'Service unavailable',
      code: 'PROSPECTING_METRICS_DISABLED',
    });
    expect(query).not.toHaveBeenCalled();

    const forbidden = await app.inject({
      method: 'GET',
      url: '/internal/operational-snapshot',
      headers: authorization,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: 'Access denied', code: 'FORBIDDEN' });
    await app.close();
  });

  it('returns only the sanitized snapshot when the feature is explicitly enabled', async () => {
    const query = vi.fn().mockResolvedValue(snapshot);
    const app = buildApp({} as Database, {
      prospectingMetricsEnabled: true,
      authentication: { metricsTemporary },
      contractQueries: { getProspectingCityMetricsSnapshot: query },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/prospecting/city-metrics',
      headers: authorization,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
    expect(query).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects an expired metrics token', async () => {
    const app = buildApp({} as Database, {
      authentication: {
        metricsTemporary: {
          ...metricsTemporary,
          expiresAt: new Date(Date.now() - 1_000),
        },
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/prospecting/city-metrics',
      headers: authorization,
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
