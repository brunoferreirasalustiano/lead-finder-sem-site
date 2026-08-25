import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { hmlDaily6AuthPermissions, hmlDiscoveryAuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions, serializeRequestForLog } from './auth.js';

const apiToken = 'synthetic-api-token-for-discovery-preflight-0001';
const daily6Token = 'synthetic-daily6-token-for-discovery-preflight-0001';
const discoveryToken = 'synthetic-discovery-token-for-preflight-0001';
const path = '/internal/discovery/preflight';

const temporaryAuthentication = (expiresAt = new Date(Date.now() + 60_000)) => ({
  token: apiToken,
  principalPermissions: permissions,
  daily6Temporary: {
    tokenHash: createHash('sha256').update(daily6Token, 'utf8').digest('hex'),
    expiresAt: new Date(Date.now() + 60_000),
    principalId: 'hml-daily6-preflight-test',
    principalPermissions: hmlDaily6AuthPermissions,
    environment: 'homologation' as const,
  },
  discoveryTemporary: {
    tokenHash: createHash('sha256').update(discoveryToken, 'utf8').digest('hex'),
    expiresAt,
    principalId: 'hml-discovery-preflight-test',
    principalPermissions: hmlDiscoveryAuthPermissions,
    environment: 'homologation' as const,
  },
});

describe('discovery authentication preflight route', () => {
  it('accepts only the dedicated discovery principal', async () => {
    const app = buildApp({} as Database, {
      discoveryAuthRequired: true,
      authentication: temporaryAuthentication(),
    });

    const unauthenticated = await app.inject({ method: 'GET', url: path });
    expect(unauthenticated.statusCode).toBe(401);

    for (const token of [apiToken, daily6Token]) {
      const denied = await app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(denied.statusCode).toBe(403);
    }

    const accepted = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${discoveryToken}` },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      discoveryAuth: 'PASS',
      collectionPermission: 'PASS',
    });
    await app.close();
  });

  it('is read-only, bounded, no-store and performs no commercial side effects', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, {
      get() {
        databaseAccesses += 1;
        throw new Error('database must not be accessed by discovery preflight');
      },
    });
    const enqueueCollection = vi.fn();
    const processLeadBatch = vi.fn();
    const deliverManualEmail = vi.fn();
    const app = buildApp(db, {
      discoveryAuthRequired: true,
      authentication: temporaryAuthentication(),
      enqueueCollection,
      processLeadBatch,
      deliverManualEmail,
    });

    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${discoveryToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['pragma']).toBe('no-cache');
    expect(response.body).not.toMatch(/token|secret|email|phone|lead|provider/i);
    expect(databaseAccesses).toBe(0);
    expect(enqueueCollection).not.toHaveBeenCalled();
    expect(processLeadBatch).not.toHaveBeenCalled();
    expect(deliverManualEmail).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an expired discovery bearer before the route runs', async () => {
    const app = buildApp({} as Database, {
      discoveryAuthRequired: true,
      authentication: temporaryAuthentication(new Date(Date.now() - 1_000)),
    });

    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${discoveryToken}` },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('is unavailable by default when dedicated discovery auth is disabled', async () => {
    const app = buildApp({} as Database, {
      authentication: temporaryAuthentication(),
    });

    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${discoveryToken}` },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('keeps request-log serialization free of authorization material', () => {
    expect(serializeRequestForLog({
      method: 'GET',
      url: path,
      hostname: 'lead-finder-api-hml.onrender.com',
      ip: '127.0.0.1',
      id: 'request-id',
    } as never)).toEqual({
      method: 'GET',
      url: path,
      host: 'lead-finder-api-hml.onrender.com',
      remoteAddress: '127.0.0.1',
      requestId: 'request-id',
    });
  });
});
