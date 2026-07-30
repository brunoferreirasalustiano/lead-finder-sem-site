import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  OperatorEmailTestError,
  sendOperatorEmailTest,
  type Database,
  type OperatorEmailDelivery,
} from '@lead-finder/database';
import { installAuthorization } from './auth.js';
import { registerOperatorEmailTestRoute } from './operator-email-test-routes.js';

const token = 'operator-email-route-token-0000000001';
const db = {} as Database;
const runtime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedRecipient: 'operator@example.test',
  authorizedSender: 'operator@example.test',
  fingerprintKey: 'operator-email-test-fingerprint-key-0001',
} as const;
const deliver = vi.fn<OperatorEmailDelivery>();
const operationResult = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  state: 'DELIVERED' as const,
  purpose: 'OPERATOR_TEST' as const,
  channel: 'EMAIL' as const,
  templateId: 'operator-email-channel-test' as const,
  templateVersion: 'v1' as const,
  reservedAt: new Date('2026-07-30T00:00:00.000Z'),
  occurredAt: new Date('2026-07-30T00:00:01.000Z'),
  replayed: false,
};

async function createApp(
  permissions: ('operator-email-test:send' | 'pilot:read')[],
  operation = vi.fn<typeof sendOperatorEmailTest>().mockResolvedValue(operationResult),
) {
  const app = Fastify({ logger: false });
  installAuthorization(app, {
    token,
    principalId: 'operator-bruno',
    principalPermissions: permissions,
  });
  registerOperatorEmailTestRoute(app, db, runtime, deliver, operation);
  await app.ready();
  return { app, operation };
}

const headers = {
  authorization: `Bearer ${token}`,
  'idempotency-key': 'operator-email-key-0001',
};
const payload = {
  templateId: 'operator-email-channel-test',
  templateVersion: 'v1',
};

describe('operator email test HTTP API', () => {
  it('requires authentication and the dedicated permission', async () => {
    const { app } = await createApp(['pilot:read']);
    expect((await app.inject({
      method: 'POST',
      url: '/operator-tests/email/send',
      payload,
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'POST',
      url: '/operator-tests/email/send',
      headers,
      payload,
    })).statusCode).toBe(403);
    await app.close();
  });

  it('accepts only the fixed template and returns sanitized metadata', async () => {
    const { app, operation } = await createApp(['operator-email-test:send']);
    expect((await app.inject({
      method: 'POST',
      url: '/operator-tests/email/send',
      headers,
      payload: { ...payload, to: 'lead@example.test' },
    })).statusCode).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/operator-tests/email/send',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      attemptId: operationResult.attemptId,
      state: 'DELIVERED',
      purpose: 'OPERATOR_TEST',
      channel: 'EMAIL',
      replayed: false,
    });
    expect(response.body).not.toContain('@example.test');
    expect(response.body).not.toContain('fingerprint-key');
    expect(operation).toHaveBeenCalledWith(
      db,
      { ...payload, idempotencyKey: 'operator-email-key-0001' },
      expect.objectContaining({ principalId: 'operator-bruno' }),
      runtime,
      deliver,
    );
    await app.close();
  });

  it('sanitizes operational failures', async () => {
    const operation = vi.fn<typeof sendOperatorEmailTest>().mockRejectedValue(
      new OperatorEmailTestError(
        'SMTP rejected operator@example.test using secret',
        'DELIVERY_FAILED',
      ),
    );
    const { app } = await createApp(['operator-email-test:send'], operation);
    const response = await app.inject({
      method: 'POST',
      url: '/operator-tests/email/send',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'Operator email test failed',
      code: 'DELIVERY_FAILED',
    });
    expect(response.body).not.toContain('operator@example.test');
    expect(response.body).not.toContain('secret');
    await app.close();
  });
});
