import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database, Daily6SlotRuntime } from '@lead-finder/database';
import { hmlDaily6AuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions, serializeRequestForLog } from './auth.js';

const apiToken = 'synthetic-api-token-for-runtime-preflight-0001';
const daily6Token = 'synthetic-daily6-token-for-runtime-preflight-0001';
const operationalSha = 'a'.repeat(40);
const path = `/internal/daily6/runtime-preflight?expectedOperationalSha=${operationalSha}`;
const validDiscoveryAuth = () => ({
  discoveryAuthRequired: true,
  discoveryAuthExpiresAt: new Date(Date.now() + 60_000),
});

const runtime = (overrides: Partial<Daily6SlotRuntime> = {}): Daily6SlotRuntime => ({
  enabled: true,
  realSendEnabled: true,
  manualEmailSendEnabled: true,
  killSwitchEnabled: false,
  sender: 'leadfinderbrasil@gmail.com',
  fingerprintKey: 'synthetic-fingerprint-key-that-is-never-read',
  operationalSha,
  deliver: vi.fn(),
  searchSent: vi.fn(),
  ...overrides,
});

const authentication = {
  token: apiToken,
  principalPermissions: permissions,
  daily6Temporary: {
    tokenHash: createHash('sha256').update(daily6Token, 'utf8').digest('hex'),
    expiresAt: new Date(Date.now() + 60_000),
    principalId: 'hml-daily6-runtime-preflight',
    principalPermissions: hmlDaily6AuthPermissions,
    environment: 'homologation' as const,
  },
};

const daily6Request = (app: ReturnType<typeof buildApp>, url = path) => app.inject({
  method: 'GET',
  url,
  headers: { authorization: `Bearer ${daily6Token}` },
});

describe('Daily-6 runtime contract preflight route', () => {
  it('requires authentication and rejects the broad API principal', async () => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(),
      ...validDiscoveryAuth(),
      authentication,
    });

    const unauthenticated = await app.inject({ method: 'GET', url: path });
    expect(unauthenticated.statusCode).toBe(401);
    const broadApi = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(broadApi.statusCode).toBe(403);
    await app.close();
  });

  it('returns only the sanitized PASS contract and performs no side effects', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, {
      get() {
        databaseAccesses += 1;
        throw new Error('database must not be accessed by runtime preflight');
      },
    });
    const slotRuntime = runtime();
    const enqueueCollection = vi.fn();
    const processLeadBatch = vi.fn();
    const deliverManualEmail = vi.fn();
    const app = buildApp(db, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: slotRuntime,
      ...validDiscoveryAuth(),
      authentication,
      enqueueCollection,
      processLeadBatch,
      deliverManualEmail,
    });

    const response = await daily6Request(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runtimeConfigured: true,
      operationalShaMatch: true,
      daily6RuntimeReady: true,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.body).not.toContain(operationalSha);
    expect(response.body).not.toMatch(/token|secret|sender|fingerprint|email/i);
    expect(databaseAccesses).toBe(0);
    expect(enqueueCollection).not.toHaveBeenCalled();
    expect(processLeadBatch).not.toHaveBeenCalled();
    expect(deliverManualEmail).not.toHaveBeenCalled();
    expect(slotRuntime.deliver).not.toHaveBeenCalled();
    expect(slotRuntime.searchSent).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails closed when the expected SHA does not match without revealing either SHA', async () => {
    const suppliedSha = 'b'.repeat(40);
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(),
      ...validDiscoveryAuth(),
      authentication,
    });

    const response = await daily6Request(
      app,
      `/internal/daily6/runtime-preflight?expectedOperationalSha=${suppliedSha}`,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      runtimeConfigured: true,
      operationalShaMatch: false,
      daily6RuntimeReady: false,
      errorClass: 'OPERATIONAL_SHA_MISMATCH',
    });
    expect(response.body).not.toContain(operationalSha);
    expect(response.body).not.toContain(suppliedSha);
    await app.close();
  });

  it('fails closed when runtime configuration is missing', async () => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      authentication,
    });

    const response = await daily6Request(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      runtimeConfigured: false,
      operationalShaMatch: false,
      daily6RuntimeReady: false,
      errorClass: 'MISSING_CONFIG',
    });
    await app.close();
  });

  it.each([
    { realSendEnabled: false },
    { manualEmailSendEnabled: false },
    { killSwitchEnabled: true },
    { sender: 'unexpected@example.invalid' },
    { enabled: false },
  ] satisfies Array<Partial<Daily6SlotRuntime>>)('fails closed when runtime is not ready: %o', async (override) => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(override),
      ...validDiscoveryAuth(),
      authentication,
    });

    const response = await daily6Request(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      runtimeConfigured: true,
      operationalShaMatch: true,
      daily6RuntimeReady: false,
      errorClass: 'RUNTIME_NOT_READY',
    });
    await app.close();
  });

  it.each([
    '/internal/daily6/runtime-preflight',
    '/internal/daily6/runtime-preflight?expectedOperationalSha=short',
    `/internal/daily6/runtime-preflight?expectedOperationalSha=${operationalSha}&unexpected=true`,
  ])('rejects invalid or extended query contracts: %s', async (url) => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(),
      ...validDiscoveryAuth(),
      authentication,
    });

    const response = await daily6Request(app, url);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      runtimeConfigured: false,
      operationalShaMatch: false,
      daily6RuntimeReady: false,
      errorClass: 'INVALID_REQUEST',
    });
    await app.close();
  });

  it('is unavailable by default when the HML Daily-6 guard is disabled', async () => {
    const app = buildApp({} as Database, {
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(),
      authentication,
    });

    const response = await daily6Request(app);
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it.each([
    {
      discoveryAuthRequired: false,
      discoveryAuthExpiresAt: new Date(Date.now() + 60_000),
      errorClass: 'DISCOVERY_AUTH_NOT_READY',
    },
    {
      discoveryAuthRequired: true,
      discoveryAuthExpiresAt: undefined,
      errorClass: 'DISCOVERY_AUTH_NOT_READY',
    },
    {
      discoveryAuthRequired: true,
      discoveryAuthExpiresAt: new Date(Date.now() - 1_000),
      errorClass: 'DISCOVERY_AUTH_EXPIRED',
    },
  ])('fails before slot readiness when discovery auth is unavailable: $errorClass', async ({
    discoveryAuthRequired,
    discoveryAuthExpiresAt,
    errorClass,
  }) => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      daily6PilotEnabled: true,
      expectedOperationalSha: operationalSha,
      daily6SlotRuntime: runtime(),
      discoveryAuthRequired,
      ...(discoveryAuthExpiresAt ? { discoveryAuthExpiresAt } : {}),
      authentication,
    });

    const response = await daily6Request(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      runtimeConfigured: true,
      operationalShaMatch: true,
      daily6RuntimeReady: false,
      errorClass,
    });
    expect(response.body).not.toMatch(/expiresAt|token|secret/i);
    await app.close();
  });

  it('removes query data from request-log serialization', () => {
    expect(serializeRequestForLog({
      method: 'GET',
      url: path,
      hostname: 'lead-finder-api-hml.onrender.com',
      ip: '127.0.0.1',
      id: 'request-id',
    } as never)).toEqual({
      method: 'GET',
      url: '/internal/daily6/runtime-preflight',
      host: 'lead-finder-api-hml.onrender.com',
      remoteAddress: '127.0.0.1',
      requestId: 'request-id',
    });
  });
});
