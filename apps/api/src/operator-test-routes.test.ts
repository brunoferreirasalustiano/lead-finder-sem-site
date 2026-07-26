import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  confirmOperatorTestResult,
  OperatorChannelTestError,
  prepareOperatorWhatsAppTest,
  recordOperatorTestOpen,
  recordOperatorTestResponse,
  type Database,
  type OperatorTestRuntime,
} from '@lead-finder/database';
import { installAuthorization, type Permission } from './auth.js';
import { registerOperatorTestRoutes } from './operator-test-routes.js';

const token = 'operator-test-route-token-000000000001';
const preparationId = '11111111-1111-4111-8111-111111111111';
const runtime: OperatorTestRuntime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedPhoneE164: '+5511999999999',
  fingerprintKey: 'operator-test-fingerprint-key-0001',
};
const db = {} as Database;

const defaultOperations = () => ({
  prepare: vi.fn(async (..._args: Parameters<typeof prepareOperatorWhatsAppTest>) => ({
    preparationId,
    state: 'PREPARED' as const,
    purpose: 'OPERATOR_TEST' as const,
    channel: 'WHATSAPP' as const,
    templateId: 'operator-whatsapp-channel-test',
    templateVersion: 'v1',
    recipientFingerprint: 'a'.repeat(64),
    message: 'Internal operator test',
    link: 'https://wa.me/5511999999999?text=Internal%20operator%20test',
    preparedAt: new Date('2026-07-26T00:00:00.000Z'),
    replayed: false,
  })),
  open: vi.fn(async (..._args: Parameters<typeof recordOperatorTestOpen>) => ({
    eventId: '22222222-2222-4222-8222-222222222222',
    state: 'OPENED' as const,
    result: undefined,
    createdAt: new Date('2026-07-26T00:01:00.000Z'),
    replayed: false,
  })),
  confirm: vi.fn(async (...args: Parameters<typeof confirmOperatorTestResult>) => ({
    eventId: '33333333-3333-4333-8333-333333333333',
    state: 'CONTACT_CONFIRMED' as const,
    result: args[2].result,
    createdAt: new Date('2026-07-26T00:02:00.000Z'),
    replayed: false,
  })),
  response: vi.fn(async (...args: Parameters<typeof recordOperatorTestResponse>) => ({
    eventId: '44444444-4444-4444-8444-444444444444',
    state: 'RESPONSE_RECORDED' as const,
    result: args[2].result,
    createdAt: new Date('2026-07-26T00:03:00.000Z'),
    replayed: false,
  })),
});

async function createApp(permissions: readonly Permission[], operations = defaultOperations()) {
  const app = Fastify({ logger: false });
  installAuthorization(app, { token, principalId: 'operator-bruno', principalPermissions: permissions });
  registerOperatorTestRoutes(app, db, runtime, operations);
  await app.ready();
  return { app, operations };
}

const headers = {
  authorization: `Bearer ${token}`,
  'idempotency-key': 'operator-test-key-0001',
};

describe('operator test HTTP API', () => {
  it('requires authentication and a dedicated preparation permission', async () => {
    const { app } = await createApp(['pilot:read']);
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/operator-tests/whatsapp/preparations',
      payload: { templateId: 'operator-whatsapp-channel-test', templateVersion: 'v1' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/operator-tests/whatsapp/preparations',
      headers,
      payload: { templateId: 'operator-whatsapp-channel-test', templateVersion: 'v1' },
    });
    expect(forbidden.statusCode).toBe(403);
    await app.close();
  });

  it('prepares through the isolated core, requires idempotency and returns only safe metadata', async () => {
    const { app, operations } = await createApp(['operator-test:prepare']);
    const missingKey = await app.inject({
      method: 'POST',
      url: '/operator-tests/whatsapp/preparations',
      headers: { authorization: `Bearer ${token}` },
      payload: { templateId: 'operator-whatsapp-channel-test', templateVersion: 'v1' },
    });
    expect(missingKey.statusCode).toBe(400);

    const response = await app.inject({
      method: 'POST',
      url: '/operator-tests/whatsapp/preparations',
      headers,
      payload: { templateId: 'operator-whatsapp-channel-test', templateVersion: 'v1' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      preparationId,
      state: 'PREPARED',
      purpose: 'OPERATOR_TEST',
      channel: 'WHATSAPP',
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      preparedAt: '2026-07-26T00:00:00.000Z',
      replayed: false,
    });
    expect(response.body).not.toContain('Internal operator test');
    expect(response.body).not.toContain('wa.me');
    expect(response.body).not.toContain('5511999999999');
    expect(response.body).not.toContain('a'.repeat(64));
    expect(operations.prepare).toHaveBeenCalledTimes(1);
    const call = operations.prepare.mock.calls[0]!;
    expect(call[1]).toEqual({
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      idempotencyKey: 'operator-test-key-0001',
    });
    expect(call[2].principalId).toBe('operator-bruno');
    await app.close();
  });

  it('keeps open, confirmation and response permissions independent', async () => {
    const { app } = await createApp(['operator-test:prepare']);
    const response = await app.inject({
      method: 'POST',
      url: `/operator-test-preparations/${preparationId}/open`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('routes each state command with strict schemas', async () => {
    const { app, operations } = await createApp([
      'operator-test:open',
      'operator-test:confirm',
      'operator-test:response',
    ]);
    const opened = await app.inject({
      method: 'POST',
      url: `/operator-test-preparations/${preparationId}/open`,
      headers,
      payload: {},
    });
    expect(opened.statusCode).toBe(200);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/operator-test-preparations/${preparationId}/confirm`,
      headers: { ...headers, 'idempotency-key': 'operator-test-key-0002' },
      payload: { result: 'NOT_SENT' },
    });
    expect(confirmed.statusCode).toBe(200);

    const responded = await app.inject({
      method: 'POST',
      url: `/operator-test-preparations/${preparationId}/response`,
      headers: { ...headers, 'idempotency-key': 'operator-test-key-0003' },
      payload: { result: 'NOT_RECEIVED' },
    });
    expect(responded.statusCode).toBe(200);
    expect(operations.open).toHaveBeenCalledTimes(1);
    expect(operations.confirm).toHaveBeenCalledTimes(1);
    expect(operations.response).toHaveBeenCalledTimes(1);

    const extraField = await app.inject({
      method: 'POST',
      url: `/operator-test-preparations/${preparationId}/confirm`,
      headers: { ...headers, 'idempotency-key': 'operator-test-key-0004' },
      payload: { result: 'SENT_CONFIRMED', observation: '+5511999999999' },
    });
    expect(extraField.statusCode).toBe(400);
    await app.close();
  });

  it('returns sanitized errors without exposing private configuration', async () => {
    const operations = defaultOperations();
    operations.prepare.mockImplementation(async (..._args: Parameters<typeof prepareOperatorWhatsAppTest>) => {
      throw new OperatorChannelTestError(
        'Kill switch blocked +5511999999999 with secret operator-test-fingerprint-key-0001',
        'KILL_SWITCH_ENGAGED',
      );
    });
    const { app } = await createApp(['operator-test:prepare'], operations);
    const response = await app.inject({
      method: 'POST',
      url: '/operator-tests/whatsapp/preparations',
      headers,
      payload: { templateId: 'operator-whatsapp-channel-test', templateVersion: 'v1' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'Operator test operation failed',
      code: 'KILL_SWITCH_ENGAGED',
    });
    expect(response.body).not.toContain('+5511999999999');
    expect(response.body).not.toContain('fingerprint-key');
    await app.close();
  });
});
