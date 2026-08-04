import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp } from './app.js';

const token = 'synthetic-api-token-for-prospecting-metrics-tests-0001';
const snapshot = {
  currentCity: 'Campinas' as const,
  nextCity: 'Valinhos' as const,
  cities: [],
};

describe('prospecting city metrics endpoint', () => {
  it('requires authentication and the metrics permission', async () => {
    const app = buildApp({} as Database, {
      prospectingMetricsEnabled: true,
      authentication: { token, principalPermissions: [] },
      contractQueries: { getProspectingCityMetricsSnapshot: vi.fn().mockResolvedValue(snapshot) },
    });
    expect((await app.inject({ method: 'GET', url: '/internal/prospecting/city-metrics' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/internal/prospecting/city-metrics', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    await app.close();
  });

  it('fails closed when disabled and returns a sanitized snapshot when enabled', async () => {
    const query = vi.fn().mockResolvedValue(snapshot);
    const disabled = buildApp({} as Database, {
      authentication: { token, principalPermissions: ['prospecting:metrics:read'] },
      contractQueries: { getProspectingCityMetricsSnapshot: query },
    });
    const disabledResponse = await disabled.inject({ method: 'GET', url: '/internal/prospecting/city-metrics', headers: { authorization: `Bearer ${token}` } });
    expect(disabledResponse.statusCode).toBe(503);
    expect(disabledResponse.json()).toEqual({ error: 'Service unavailable', code: 'PROSPECTING_METRICS_DISABLED' });
    await disabled.close();

    const enabled = buildApp({} as Database, {
      prospectingMetricsEnabled: true,
      authentication: { token, principalPermissions: ['prospecting:metrics:read'] },
      contractQueries: { getProspectingCityMetricsSnapshot: query },
    });
    const enabledResponse = await enabled.inject({ method: 'GET', url: '/internal/prospecting/city-metrics', headers: { authorization: `Bearer ${token}` } });
    expect(enabledResponse.statusCode).toBe(200);
    expect(enabledResponse.json()).toEqual(snapshot);
    expect(query).toHaveBeenCalledTimes(1);
    await enabled.close();
  });
});
