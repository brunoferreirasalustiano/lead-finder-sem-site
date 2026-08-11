import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import type { ApiAuthPermission } from '@lead-finder/shared';
import { installAuthorization } from './auth.js';
import { registerHmlSuppressionProbeRoute } from './hml-suppression-probe-route.js';

const token = 'synthetic-hml-probe-token-for-tests-000000000000000000000';
const result = {
  status: 'PASS' as const,
  suppressionMatched: true as const,
  sendEligible: false as const,
  providerCalls: 0 as const,
  fixtureRolledBack: true as const,
  fixtureRowsRemaining: 0 as const,
};

const appFor = (enabled: boolean, permissions: readonly ApiAuthPermission[] = ['hml-suppression-probe:run']) => {
  const app = Fastify({ logger: false });
  installAuthorization(app, { token, principalPermissions: permissions });
  registerHmlSuppressionProbeRoute(app, {} as Database, {
    enabled,
    deploymentEnvironment: 'homologation',
    probe: vi.fn().mockResolvedValue(result),
  });
  return app;
};

describe('HML hosted suppression probe route', () => {
  it('is unavailable when the explicit HML flag is disabled', async () => {
    const app = appFor(false);
    const response = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('is unavailable outside the homologation deployment environment', async () => {
    const app = Fastify({ logger: false });
    installAuthorization(app, { token, principalPermissions: ['hml-suppression-probe:run'] });
    registerHmlSuppressionProbeRoute(app, {} as Database, {
      enabled: true,
      deploymentEnvironment: 'production',
      probe: vi.fn().mockResolvedValue(result),
    });
    const response = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('requires authentication and the dedicated permission', async () => {
    const anonymous = appFor(true);
    expect((await anonymous.inject({ method: 'POST', url: '/internal/hml/suppression-probe', payload: {} })).statusCode).toBe(401);
    await anonymous.close();

    const forbidden = appFor(true, []);
    expect((await forbidden.inject({ method: 'POST', url: '/internal/hml/suppression-probe', headers: { authorization: `Bearer ${token}` }, payload: {} })).statusCode).toBe(403);
    await forbidden.close();
  });

  it('returns only the sanitized proof and rejects arbitrary recipient input', async () => {
    const app = appFor(true);
    const response = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: { recipient: 'someone@example.invalid' },
    });
    expect(response.statusCode).toBe(400);
    const success = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toEqual(result);
    expect(success.body).not.toContain('@example.invalid');
    await app.close();
  });

  it('consumes the HML probe once and rejects replay', async () => {
    const app = appFor(true);
    const first = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    const second = await app.inject({
      method: 'POST', url: '/internal/hml/suppression-probe',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'HML_SUPPRESSION_PROBE_ALREADY_USED' });
    await app.close();
  });
});
