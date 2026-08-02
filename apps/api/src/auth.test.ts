import { createHash } from 'node:crypto';
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

  it('protects the manual WhatsApp redirect before request validation or database access', async () => {
    const preparationId = '123e4567-e89b-42d3-a456-426614174000';
    const anonymousApp = buildApp({} as Database, { authentication: { token, principalPermissions: ['manual-messaging:open'] } });
    expect((await anonymousApp.inject({ method: 'GET', url: `/manual-message-preparations/${preparationId}/whatsapp-link` })).statusCode).toBe(401);
    await anonymousApp.close();

    const forbiddenApp = buildApp({} as Database, { authentication: { token, principalPermissions: [] } });
    expect((await forbiddenApp.inject({ method: 'GET', url: `/manual-message-preparations/${preparationId}/whatsapp-link`, headers: authorization })).statusCode).toBe(403);
    await forbiddenApp.close();

    const malformedApp = buildApp({} as Database, { authentication: { token, principalPermissions: ['manual-messaging:open'] } });
    const malformed = await malformedApp.inject({
      method: 'GET', url: '/manual-message-preparations/not-a-uuid/whatsapp-link', headers: authorization,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toMatch(/wa\.me|text=|phone|message/i);
    await malformedApp.close();
  });

  it('accepts a valid HML smoke token only with its fixed synthetic principal and minimum permissions', async () => {
    const smokeToken = 'hml-smoke-token-for-tests-only-00000000000000000000000000000000';
    const app = Fastify({ logger: false });
    installAuthorization(app, {
      token,
      principalPermissions: ['campaigns:read'],
      temporary: {
        tokenHash: createHash('sha256').update(smokeToken, 'utf8').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        principalId: 'hml-smoke-test',
        principalPermissions: ['manual-messaging:open', 'manual-messaging:cancel'],
        environment: 'homologation',
      },
    });
    app.get('/manual-message-preparations/:id/whatsapp-link', (request) => ({
      principalId: request.principal?.id,
      permissions: [...(request.principal?.permissions ?? [])].sort(),
      source: request.principal?.authenticationSource,
    }));
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link',
      headers: { authorization: `Bearer ${smokeToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      principalId: 'hml-smoke-test',
      permissions: ['manual-messaging:cancel', 'manual-messaging:open'],
      source: 'HML_SMOKE_BEARER_TOKEN',
    });
    await app.close();
  });

  it('accepts a valid HML operator token as a distinct principal with fixed permissions', async () => {
    const operatorToken = 'hml-operator-token-for-tests-only-00000000000000000000000000000000';
    const app = Fastify({ logger: false });
    installAuthorization(app, {
      token,
      principalPermissions: [],
      operatorTemporary: {
        tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        principalId: 'hml-internal-whatsapp-operator',
        principalPermissions: ['manual-messaging:prepare', 'manual-messaging:open', 'manual-messaging:cancel', 'manual-messaging:confirm', 'manual-messaging:cloud-send'],
        environment: 'homologation',
      },
    });
    app.get('/manual-message-preparations/:id/whatsapp-link', (request) => ({
      principalId: request.principal?.id,
      permissions: [...(request.principal?.permissions ?? [])].sort(),
      source: request.principal?.authenticationSource,
    }));
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      principalId: 'hml-internal-whatsapp-operator',
      permissions: ['manual-messaging:cancel', 'manual-messaging:cloud-send', 'manual-messaging:confirm', 'manual-messaging:open', 'manual-messaging:prepare'],
      source: 'HML_OPERATOR_BEARER_TOKEN',
    });
    await app.close();
  });

  it('rejects invalid, expired, and revoked HML operator tokens', async () => {
    const operatorToken = 'hml-operator-token-for-tests-only-00000000000000000000000000000000';
    const hash = createHash('sha256').update(operatorToken, 'utf8').digest('hex');
    const makeApp = (operatorTemporary?: NonNullable<Parameters<typeof installAuthorization>[1]>['operatorTemporary']) => {
      const app = Fastify({ logger: false });
      installAuthorization(app, operatorTemporary
        ? { token, principalPermissions: [], operatorTemporary }
        : { token, principalPermissions: [] });
      app.get('/manual-message-preparations/:id/whatsapp-link', () => ({ ok: true }));
      return app;
    };
    const valid = makeApp({ tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), principalId: 'hml-internal-whatsapp-operator', principalPermissions: ['manual-messaging:confirm'], environment: 'homologation' });
    expect((await valid.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: 'Bearer wrong-token' } })).statusCode).toBe(401);
    await valid.close();
    const expired = makeApp({ tokenHash: hash, expiresAt: new Date(Date.now() - 1_000), principalId: 'hml-internal-whatsapp-operator', principalPermissions: ['manual-messaging:confirm'], environment: 'homologation' });
    expect((await expired.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: `Bearer ${operatorToken}` } })).statusCode).toBe(401);
    await expired.close();
    const revoked = makeApp(undefined);
    expect((await revoked.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: `Bearer ${operatorToken}` } })).statusCode).toBe(401);
    await revoked.close();
  });

  it('rejects invalid, expired, disabled, and revoked HML smoke tokens', async () => {
    const smokeToken = 'hml-smoke-token-for-tests-only-00000000000000000000000000000000';
    const hash = createHash('sha256').update(smokeToken, 'utf8').digest('hex');
    const makeApp = (temporary?: NonNullable<Parameters<typeof installAuthorization>[1]>['temporary']) => {
      const app = Fastify({ logger: false });
      installAuthorization(app, temporary
        ? { token, principalPermissions: [], temporary }
        : { token, principalPermissions: [] });
      app.get('/manual-message-preparations/:id/whatsapp-link', () => ({ ok: true }));
      return app;
    };
    const invalid = makeApp({ tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), principalId: 'hml-smoke-test', principalPermissions: ['manual-messaging:open'], environment: 'homologation' });
    expect((await invalid.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: 'Bearer wrong-token' } })).statusCode).toBe(401);
    await invalid.close();
    const expired = makeApp({ tokenHash: hash, expiresAt: new Date(Date.now() - 1_000), principalId: 'hml-smoke-test', principalPermissions: ['manual-messaging:open'], environment: 'homologation' });
    expect((await expired.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: `Bearer ${smokeToken}` } })).statusCode).toBe(401);
    await expired.close();
    const revoked = makeApp(undefined);
    expect((await revoked.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: `Bearer ${smokeToken}` } })).statusCode).toBe(401);
    await revoked.close();
  });

  it('rate-limits repeated invalid credentials only while HML smoke authentication is active', async () => {
    const smokeToken = 'hml-smoke-token-for-tests-only-00000000000000000000000000000000';
    const app = Fastify({ logger: false });
    installAuthorization(app, {
      token,
      principalPermissions: [],
      temporary: {
        tokenHash: createHash('sha256').update(smokeToken, 'utf8').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        principalId: 'hml-smoke-test',
        principalPermissions: ['manual-messaging:open'],
        environment: 'homologation',
      },
    });
    app.get('/manual-message-preparations/:id/whatsapp-link', () => ({ ok: true }));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await app.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: 'Bearer invalid-smoke-token' } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/whatsapp-link', headers: { authorization: 'Bearer invalid-smoke-token' } })).statusCode).toBe(429);
    await app.close();
  });

  it('denies SENT_CONFIRMED to the HML smoke principal even when confirm permission is present', async () => {
    const smokeToken = 'hml-smoke-token-for-tests-only-00000000000000000000000000000000';
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, {
      authentication: {
        token,
        principalPermissions: [],
        temporary: {
          tokenHash: createHash('sha256').update(smokeToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-smoke-test',
          principalPermissions: ['manual-messaging:confirm'],
          environment: 'homologation',
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/confirm',
      headers: { authorization: `Bearer ${smokeToken}`, 'idempotency-key': 'smoke-confirm-0001' },
      payload: { result: 'SENT_CONFIRMED' },
    });
    expect(response.statusCode).toBe(403);
    expect(databaseAccesses).toBe(0);
    await app.close();
  });

  it('allows SENT_CONFIRMED only for the separate HML operator principal after OPENED', async () => {
    const operatorToken = 'hml-operator-token-for-tests-only-00000000000000000000000000000000';
    let executions = 0;
    const tx = {
      execute: () => {
        executions += 1;
        if (executions === 3) return [{ pilot_run_id: '20dfeb9d-30f0-4d5a-8762-3dbb4ed506aa', lead_id: leadId, contact_id: '123e4567-e89b-42d3-a456-426614174000', channel: 'WHATSAPP', result_fingerprint: 'a'.repeat(64), result_snapshot: {}, operator_principal_id: 'hml-internal-whatsapp-operator', expires_at: new Date(Date.now() + 60_000), expired: false }];
        if (executions === 6) return [{ contact_id: '123e4567-e89b-42d3-a456-426614174000', channel: 'WHATSAPP', contact_fingerprint: 'b'.repeat(64), legacy_contact_fingerprint: 'c'.repeat(64), contact_source: 'HML_OPERATOR_CONTROLLED', lead_name: 'HML synthetic operator', contact_value: '+15555550123' }];
        if (executions === 7) return [{ id: '123e4567-e89b-42d3-a456-426614174000', event_type: 'OPENED', result: null, created_at: new Date(), operator_principal_id: 'hml-internal-whatsapp-operator', payload_fingerprint: 'd'.repeat(64) }];
        if (executions === 8) return [{ id: '123e4567-e89b-42d3-a456-426614174001', created_at: new Date() }];
        return [];
      },
    };
    const db = { transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx) } as unknown as Database;
    const app = buildApp(db, {
      authentication: {
        token,
        principalPermissions: [],
        operatorTemporary: {
          tokenHash: createHash('sha256').update(operatorToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-internal-whatsapp-operator',
          principalPermissions: ['manual-messaging:confirm'],
          environment: 'homologation',
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/confirm',
      headers: { authorization: `Bearer ${operatorToken}`, 'idempotency-key': 'operator-confirm-0001' },
      payload: { result: 'SENT_CONFIRMED' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ state: 'CONTACT_CONFIRMED', result: 'SENT_CONFIRMED', replayed: false });
    await app.close();
  });

  it('requires the dedicated cancellation permission before database access', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, { get: () => { databaseAccesses += 1; throw new Error('database accessed'); } });
    const app = buildApp(db, { authentication: { token, principalPermissions: ['manual-messaging:open'] } });
    const response = await app.inject({
      method: 'POST',
      url: '/manual-message-preparations/123e4567-e89b-42d3-a456-426614174000/cancel',
      headers: { ...authorization, 'idempotency-key': 'cancel-permission-test-0001' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(databaseAccesses).toBe(0);
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
    expect(routePolicies.filter(({ path }) => path.startsWith('/manual-message-preparations'))).toEqual([
      { method: 'POST', path: '/manual-message-preparations/:id/open', permission: 'manual-messaging:open' },
      { method: 'GET', path: '/manual-message-preparations/:id/whatsapp-link', permission: 'manual-messaging:open' },
      { method: 'POST', path: '/manual-message-preparations/:id/cancel', permission: 'manual-messaging:cancel' },
      { method: 'POST', path: '/manual-message-preparations/:id/confirm', permission: 'manual-messaging:confirm' },
      { method: 'POST', path: '/manual-message-preparations/:id/response', permission: 'manual-messaging:confirm' },
      { method: 'POST', path: '/manual-message-preparations/:id/send', permission: 'manual-messaging:send' },
      { method: 'POST', path: '/manual-message-preparations/:id/whatsapp-cloud-send', permission: 'manual-messaging:cloud-send' },
    ]);
    expect(routePolicies).toContainEqual({
      method: 'POST',
      path: '/operator-tests/email/send',
      permission: 'operator-email-test:send',
    });
    expect(routePolicies.length).toBeGreaterThan(40);
    expect(new Set(routePolicies.map(({ method, path }) => `${method} ${path}`)).size).toBe(routePolicies.length);
  });
});
