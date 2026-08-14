import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@lead-finder/database';
import { hmlDaily6AuthPermissions } from '@lead-finder/shared';
import { buildApp } from './app.js';
import { permissions } from './auth.js';

const apiToken = 'synthetic-api-token-for-gmail-preflight-0001';
const hmlToken = 'synthetic-hml-daily6-token-for-gmail-preflight-0001';
const preflightPath = '/internal/daily6/gmail-preflight';
const configDiagnosticsPath = '/internal/daily6/gmail-config-diagnostics';
const pass = () => Promise.resolve({ gmailAuth: 'PASS' as const, sentSearch: 'PASS' as const });

const authenticated = (app: ReturnType<typeof buildApp>) => app.inject({
  method: 'GET',
  url: preflightPath,
  headers: { authorization: `Bearer ${apiToken}` },
});

describe('Daily-6 Gmail read-only preflight route', () => {
  it('requires internal authentication', async () => {
    const app = buildApp({} as Database, {
      authentication: { token: apiToken, principalPermissions: permissions },
      daily6GmailPreflight: pass,
    });

    await expect(app.inject({ method: 'GET', url: preflightPath })).resolves.toMatchObject({
      statusCode: 401,
    });
    await app.close();
  });

  it('returns only the sanitized PASS contract and performs no persistence or delivery work', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, {
      get() {
        databaseAccesses += 1;
        throw new Error('database must not be accessed by Gmail preflight');
      },
    });
    const preflight = vi.fn().mockResolvedValue({
      gmailAuth: 'PASS',
      sentSearch: 'PASS',
      messageId: 'must-not-be-returned',
    });
    const deliver = vi.fn();
    const enqueue = vi.fn();
    const processLeadBatch = vi.fn();
    const app = buildApp(db, {
      authentication: { token: apiToken, principalPermissions: permissions },
      daily6GmailPreflight: preflight,
      deliverManualEmail: deliver,
      enqueueCollection: enqueue,
      processLeadBatch,
    });

    const response = await authenticated(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ gmailAuth: 'PASS', sentSearch: 'PASS' });
    expect(response.body).not.toMatch(/token|secret|message|email|subject|body|authorization/i);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(databaseAccesses).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(processLeadBatch).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails closed without leaking a provider error or sensitive value', async () => {
    const app = buildApp({} as Database, {
      authentication: { token: apiToken, principalPermissions: permissions },
      daily6GmailPreflight: vi.fn().mockRejectedValue(new Error('refresh secret must not be returned')),
    });

    const response = await authenticated(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      gmailAuth: 'FAIL',
      sentSearch: 'NOT_PROVEN',
      errorClass: 'UNKNOWN',
    });
    expect(response.body).not.toContain('refresh secret');
    await app.close();
  });

  it('returns a classified Gmail failure without attempting a send', async () => {
    const app = buildApp({} as Database, {
      authentication: { token: apiToken, principalPermissions: permissions },
      daily6GmailPreflight: vi.fn().mockResolvedValue({
        gmailAuth: 'PASS',
        sentSearch: 'NOT_PROVEN',
        errorClass: 'GOOGLE_API_ERROR',
      }),
    });

    const response = await authenticated(app);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      gmailAuth: 'PASS',
      sentSearch: 'NOT_PROVEN',
      errorClass: 'GOOGLE_API_ERROR',
    });
    await app.close();
  });

  it('requires the HML Daily-6 bearer when the HML auth guard is enabled', async () => {
    const app = buildApp({} as Database, {
      daily6AuthRequired: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: {
          tokenHash: createHash('sha256').update(hmlToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-daily6-preflight',
          principalPermissions: hmlDaily6AuthPermissions,
          environment: 'homologation',
        },
      },
      daily6GmailPreflight: pass,
    });

    const regular = await authenticated(app);
    expect(regular.statusCode).toBe(403);
    const hml = await app.inject({
      method: 'GET',
      url: preflightPath,
      headers: { authorization: `Bearer ${hmlToken}` },
    });
    expect(hml.statusCode).toBe(200);
    expect(hml.json()).toEqual({ gmailAuth: 'PASS', sentSearch: 'PASS' });
    await app.close();
  });

  it('returns only boolean HML Gmail configuration diagnostics and never reads the database', async () => {
    let databaseAccesses = 0;
    const db = new Proxy({} as Database, {
      get() {
        databaseAccesses += 1;
        throw new Error('database must not be accessed by Gmail config diagnostics');
      },
    });
    const app = buildApp(db, {
      daily6AuthRequired: true,
      authentication: {
        token: apiToken,
        principalPermissions: permissions,
        daily6Temporary: {
          tokenHash: createHash('sha256').update(hmlToken, 'utf8').digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
          principalId: 'hml-daily6-preflight',
          principalPermissions: hmlDaily6AuthPermissions,
          environment: 'homologation',
        },
      },
      daily6GmailConfigDiagnostics: () => ({
        manualEmailSendEnabled: false,
        senderMatch: false,
        clientIdConfigured: true,
        clientSecretConfigured: true,
        refreshTokenConfigured: true,
        fingerprintKeyConfigured: true,
        operatorEmailTestEnabled: true,
        operatorEmailTestRecipientConfigured: true,
        operatorEmailTestSenderConfigured: true,
        operatorEmailTestSenderMatch: true,
        operatorEmailTestClientIdConfigured: true,
        operatorEmailTestClientSecretConfigured: true,
        operatorEmailTestRefreshTokenConfigured: true,
        operatorEmailTestFingerprintKeyConfigured: true,
        daily6PilotEnabled: false,
        realSendEnabled: false,
        manualEmailKillSwitchEnabled: true,
        realProviderConfigured: false,
        realProvidersEnabled: false,
        collectionEgressEnabled: false,
        enrichmentEgressEnabled: false,
        hmlDaily6AuthEnabled: true,
        expectedOperationalShaConfigured: true,
      }),
    });

    const unauthorized = await app.inject({ method: 'GET', url: configDiagnosticsPath, headers: { authorization: `Bearer ${apiToken}` } });
    expect(unauthorized.statusCode).toBe(403);
    const response = await app.inject({ method: 'GET', url: configDiagnosticsPath, headers: { authorization: `Bearer ${hmlToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      manualEmailSendEnabled: false,
      senderMatch: false,
      clientIdConfigured: true,
      clientSecretConfigured: true,
      refreshTokenConfigured: true,
      fingerprintKeyConfigured: true,
      operatorEmailTestEnabled: true,
      operatorEmailTestRecipientConfigured: true,
      operatorEmailTestSenderConfigured: true,
      operatorEmailTestSenderMatch: true,
      operatorEmailTestClientIdConfigured: true,
      operatorEmailTestClientSecretConfigured: true,
      operatorEmailTestRefreshTokenConfigured: true,
      operatorEmailTestFingerprintKeyConfigured: true,
      daily6PilotEnabled: false,
      realSendEnabled: false,
      manualEmailKillSwitchEnabled: true,
      realProviderConfigured: false,
      realProvidersEnabled: false,
      collectionEgressEnabled: false,
      enrichmentEgressEnabled: false,
      hmlDaily6AuthEnabled: true,
      expectedOperationalShaConfigured: true,
    });
    expect(response.body).not.toContain(hmlToken);
    expect(response.body).not.toContain('leadfinderbrasil@gmail.com');
    expect(databaseAccesses).toBe(0);
    await app.close();
  });
});
