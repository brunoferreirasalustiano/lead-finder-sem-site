import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { buildApp } from './app.js';
import { installAuthorization, permissions, publicRoutes, routePolicies, serializeRequestForLog } from './auth.js';

const token = 'synthetic-api-token-for-tests-only-0001';
const authorization = { authorization: `Bearer ${token}` };
const leadId = '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa';
const minimalPermissions = ['pilot:read', 'pilot:write', 'pilot:review', 'pilot:record-contact', 'pilot:record-result'] as const;

describe('API authentication boundary', () => {
  it('keeps only the three exact health routes public', async () => {
    const app = buildApp({} as Database);
    for (const url of ['/health/live', '/health', '/ready', '/health/ready']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).not.toBe(401);
    }
    expect(publicRoutes).toEqual(new Set(['GET /health/live', 'GET /health', 'GET /ready', 'GET /health/ready']));
    expect((await app.inject({ method: 'GET', url: '/health/live/' })).statusCode).toBe(401);
    await app.close();
  });

  it.each([
    '/leads',
    `/leads/${leadId}`,
    `/leads/${leadId}/contacts`,
    '/leads/export.csv',
    '/internal/operational-snapshot',
  ])('changes the original anonymous PoC to 401 before database access: %s', async (url) => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: minimalPermissions } });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it.each([
    undefined,
    'Basic abc',
    'Bearer',
    'Bearer ',
    'Bearer wrong-token-that-is-long-enough-0001',
    `Bearer  ${token}`,
    `Bearer ${token}, Bearer ${token}`,
  ])('rejects absent or malformed credentials without revealing why: %s', async (header) => {
    const app = buildApp({} as Database, { authentication: { token, principalPermissions: minimalPermissions } });
    const response = await app.inject(header
      ? { method: 'GET', url: '/leads', headers: { authorization: header } }
      : { method: 'GET', url: '/leads' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    await app.close();
  });

  it('accepts case-insensitive Bearer and ignores query or client-asserted identity headers', async () => {
    const app = buildApp({} as Database, { authentication: { token, principalPermissions: ['campaigns:read'] } });
    const accepted = await app.inject({ method: 'POST', url: '/campaigns/preview?token=attacker', headers: {
      authorization: `bEaReR ${token}`, 'x-user-id': 'attacker', 'x-role': 'admin', 'x-permissions': '*',
    }, payload: { channel: 'EMAIL', content: 'Hello', allowedVariables: [], values: {} } });
    expect(accepted.statusCode).toBe(200);
    const queryOnly = await app.inject({ method: 'GET', url: `/leads?token=${encodeURIComponent(token)}` });
    expect(queryOnly.statusCode).toBe(401);
    await app.close();
  });

  it('enforces route permissions before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: ['leads:read'] } });
    expect((await app.inject({ method: 'GET', url: '/leads', headers: authorization })).statusCode).toBe(500);
    databaseAccesses = 0;
    expect((await app.inject({ method: 'GET', url: `/leads/${leadId}/contacts`, headers: authorization })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/leads/export.csv', headers: authorization })).statusCode).toBe(403);
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it('fails startup when a bearer token has no explicit permission set', () => {
    expect(() => buildApp({} as Database, { authentication: { token } })).toThrow(
      'Bearer token authentication requires explicit principal permissions',
    );
  });

  it('denies privileged routes omitted from the operational permission set', async () => {
    const app = buildApp({} as Database, { authentication: { token, principalPermissions: minimalPermissions } });
    expect((await app.inject({ method: 'GET', url: '/leads/export.csv', headers: authorization })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/collect', headers: authorization, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'PATCH', url: '/pilots/123e4567-e89b-42d3-a456-426614174000/status',
      headers: { ...authorization, 'idempotency-key': 'complete-pilot-0001' },
      payload: { status: 'COMPLETED', expectedVersion: 1 },
    })).statusCode).toBe(403);
    await app.close();
  });

  it.each([
    ['GET', '/pilots', undefined],
    ['POST', '/pilots', {}],
    ['PATCH', '/pilots/not-a-uuid/status', {}],
    ['POST', '/pilots/not-a-uuid/leads', {}],
    ['POST', '/pilots/not-a-uuid/leads/not-a-uuid/review', {}],
    ['POST', '/pilots/not-a-uuid/leads/not-a-uuid/manual-contacts', {}],
    ['POST', '/pilots/not-a-uuid/leads/not-a-uuid/results', {}],
    ['GET', '/pilots/not-a-uuid/snapshot', undefined],
  ] as const)('authorizes the relevant pilot route before its request validation: %s %s', async (method, url, payload) => {
    const app = buildApp({} as Database, { authentication: { token, principalPermissions: minimalPermissions } });
    const response = await app.inject({ method, url, headers: authorization, ...(payload ? { payload } : {}) });
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });

  it('allows only the route covered by the injected permission', async () => {
    const app = buildApp({} as Database, { authentication: { token, principalPermissions: ['campaigns:read'] } });
    const allowed = await app.inject({
      method: 'POST', url: '/campaigns/preview', headers: authorization,
      payload: { channel: 'EMAIL', content: 'Hello', allowedVariables: [], values: {} },
    });
    expect(allowed.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/pilots', headers: authorization })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/leads/export.csv', headers: authorization })).statusCode).toBe(403);
    await app.close();
  });

  it('fails closed when the authenticator throws or a route has no policy', async () => {
    const broken = Fastify({ logger: false });
    installAuthorization(broken, { authenticate: () => { throw new Error('synthetic authenticator failure'); } });
    broken.get('/protected', () => ({ unsafe: true }));
    await expect(broken.ready()).rejects.toThrow('explicit authorization policy');
    await broken.close();

    const app = Fastify({ logger: false });
    installAuthorization(app, { authenticate: () => ({
      id: 'test-operator', type: 'OPERATOR', permissions: new Set(permissions), authenticationSource: 'BEARER_TOKEN',
    }) });
    app.get('/health/live', () => ({ ok: true }));
    const response = await app.inject({ method: 'GET', url: '/unknown-protected-route', headers: authorization });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('sanitizes authentication logs and never emits the token or Authorization header', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const app = buildApp({} as Database, { authentication: { token, authenticate: () => { throw new Error(token); } } });
    try {
      expect((await app.inject({ method: 'GET', url: '/leads', headers: authorization })).statusCode).toBe(401);
      await app.close();
      const logs = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(logs).not.toContain(token);
      expect(logs).not.toMatch(/authorization/i);
      expect(logs).toContain('authentication_failed');
    } finally {
      stdout.mockRestore();
    }
  });

  it('structurally removes query strings and excludes headers and bodies from request logs', async () => {
    const canaries = [
      'synthetic-secret-canary', 'encoded-secret-canary', 'header-secret-canary',
      'identity-secret-canary', 'body-token-canary', 'body-password-canary',
    ];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const app = buildApp({} as Database, {
      authentication: { token, principalPermissions: [...minimalPermissions, 'campaigns:read'] },
    });
    try {
      const queries = [
        'token=synthetic-secret-canary',
        'access_token=encoded-secret-canary',
        'api_key=synthetic-secret-canary&password=encoded-secret-canary',
        'SECRET=synthetic-secret-canary&TOKEN=encoded-secret-canary',
        'authorization=synthetic-secret-canary&token=synthetic-secret-canary&token=encoded-secret-canary',
        'token%5B%5D=synthetic-secret-canary&token%5B%5D=encoded-secret-canary',
        'token=%65%6e%63%6f%64%65%64%2d%73%65%63%72%65%74%2d%63%61%6e%61%72%79',
        'token=%E0%A4%A',
      ];
      for (const query of queries) {
        const response = await app.inject({ method: 'GET', url: `/leads?${query}` });
        expect(response.statusCode).toBe(401);
      }
      expect((await app.inject({
        method: 'POST', url: '/campaigns/preview?secret=synthetic-secret-canary',
        headers: {
          authorization: `Bearer ${token}`, 'x-user-id': 'identity-secret-canary',
          'x-role': 'header-secret-canary', 'x-permissions': 'header-secret-canary',
        },
        payload: {
          channel: 'EMAIL', content: 'Hello', allowedVariables: [], values: {},
          token: 'body-token-canary', password: 'body-password-canary',
        },
      })).statusCode).toBe(400);
      await app.close();
      const logs = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      for (const canary of [...canaries, token]) expect(logs).not.toContain(canary);
      expect(logs).toContain('"url":"/leads"');
      expect(logs).toContain('"requestId":"req-');
      expect(logs).not.toContain('?');
    } finally {
      stdout.mockRestore();
    }
  });

  it('keeps only the request log allow-list even for serializer-shaped sensitive input', () => {
    const sensitiveRequest = {
      method: 'GET', url: '/leads?token=synthetic-secret-canary', hostname: 'localhost',
      ip: '127.0.0.1', id: 'request-1',
      headers: { authorization: 'header-secret-canary' },
      body: { password: 'body-password-canary' },
      error: new Error('stack-secret-canary'),
    };
    expect(serializeRequestForLog(sensitiveRequest as unknown as Parameters<typeof serializeRequestForLog>[0])).toEqual({
      method: 'GET', url: '/leads', host: 'localhost', remoteAddress: '127.0.0.1', requestId: 'request-1',
    });
  });

  it('maintains a unique explicit policy for every protected application route', () => {
    expect(permissions).toContain('crm:reactivate-do-not-contact');
    expect(permissions).toEqual(expect.arrayContaining([
      'pilot:read', 'pilot:write', 'pilot:review', 'pilot:record-contact',
      'pilot:record-result', 'pilot:complete',
    ]));
    expect(publicRoutes).not.toContain('GET /pilots');
    expect(routePolicies.filter(({ path }) => path.startsWith('/pilots'))).toEqual([
      { method: 'POST', path: '/pilots', permission: 'pilot:write' },
      { method: 'GET', path: '/pilots', permission: 'pilot:read' },
      { method: 'GET', path: '/pilots/:id', permission: 'pilot:read' },
      { method: 'PATCH', path: '/pilots/:id/status', permission: 'pilot:write' },
      { method: 'POST', path: '/pilots/:id/leads', permission: 'pilot:write' },
      { method: 'POST', path: '/pilots/:id/leads/:leadId/review', permission: 'pilot:review' },
      { method: 'POST', path: '/pilots/:id/leads/:leadId/manual-contacts', permission: 'pilot:record-contact' },
      { method: 'POST', path: '/pilots/:id/leads/:leadId/results', permission: 'pilot:record-result' },
      { method: 'GET', path: '/pilots/:id/snapshot', permission: 'pilot:read' },
      { method: 'POST', path: '/pilots/:id/leads/:leadId/manual-messages/prepare', permission: 'manual-messaging:prepare' },
    ]);
    expect(routePolicies.length).toBeGreaterThan(40);
    expect(new Set(routePolicies.map(({ method, path }) => `${method} ${path}`)).size).toBe(routePolicies.length);
  });
});
