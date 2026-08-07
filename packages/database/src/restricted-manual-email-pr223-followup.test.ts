import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
import { recordManualOpen } from './index.js';
import { sendPreparedManualEmail } from './restricted-manual-email.js';

const databaseIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(
  new URL('../../../apps/api/src/app.ts', import.meta.url),
  'utf8',
);
const auth = createAuthorizationContext({
  principalId: 'restricted-email-pr223-test',
  permissions: new Set([
    'manual-messaging:open',
    'manual-messaging:send',
  ]),
  authenticationMethod: 'unit-test',
});

describe('PR 223 restricted manual email follow-ups', () => {
  it('requires OPEN permission before choosing legacy or restricted dispatch', () => {
    const start = databaseIndex.indexOf('export async function recordManualOpen(');
    const end = databaseIndex.indexOf('export async function checkDatabase', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = databaseIndex.slice(start, end);
    const openGuard = section.indexOf("auth.permissions.has('manual-messaging:open')");
    const sendDispatch = section.indexOf("auth.permissions.has('manual-messaging:send')");
    const legacyDispatch = section.indexOf('recordLegacyManualOpen');
    const restrictedDispatch = section.indexOf('recordRestrictedManualOpen');
    expect(openGuard).toBeGreaterThanOrEqual(0);
    expect(sendDispatch).toBeGreaterThan(openGuard);
    expect(legacyDispatch).toBeGreaterThan(sendDispatch);
    expect(restrictedDispatch).toBeGreaterThan(legacyDispatch);
  });

  it('rejects OPEN before database access when open permission is absent', async () => {
    const execute = vi.fn();
    const db = { execute } as unknown as Database;
    const sendOnlyAuth = createAuthorizationContext({
      principalId: 'restricted-email-send-only-test',
      permissions: new Set(['manual-messaging:send']),
      authenticationMethod: 'unit-test',
    });

    await expect(recordManualOpen(
      db,
      '00000000-0000-4000-8000-000000000299',
      { idempotencyKey: 'open-denied-regression-0001' },
      sendOnlyAuth,
    )).rejects.toMatchObject({ code: 'INELIGIBLE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['DELIVERED', 'd'.repeat(64), null],
    ['FAILED', null, 'DELIVERY_REJECTED'],
    ['AMBIGUOUS', null, 'PROVIDER_OUTCOME_UNKNOWN'],
  ] as const)('replays a persisted %s send while provider delivery is disabled', async (
    eventType,
    providerMessageFingerprint,
    errorCode,
  ) => {
    const attemptId = '00000000-0000-4000-8000-000000000201';
    const deliver = vi.fn();
    const db = {
      execute: () => Promise.resolve([{
        id: attemptId,
        reserved_at: new Date('2026-08-07T12:00:00.000Z'),
        replayed: true,
        event_type: eventType,
        provider_message_fingerprint: providerMessageFingerprint,
        error_code: errorCode,
        event_created_at: new Date('2026-08-07T12:00:01.000Z'),
      }]),
    } as unknown as Database;

    const result = await sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000202',
      auth,
      {
        sendEnabled: false,
        killSwitchEnabled: true,
        sender: '',
        fingerprintKey: '',
        deliver,
      },
    );

    expect(result).toMatchObject({
      state: eventType,
      provider: 'GMAIL_API',
      replayed: true,
      attemptId,
    });
    if (providerMessageFingerprint) expect(result.messageIdFingerprint).toBe(providerMessageFingerprint);
    if (errorCode) expect(result.errorCode).toBe(errorCode);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('returns persisted IN_PROGRESS without creating a second attempt', async () => {
    const deliver = vi.fn();
    const execute = vi.fn().mockResolvedValue([{
      id: '00000000-0000-4000-8000-000000000204',
      reserved_at: new Date('2026-08-07T12:00:00.000Z'),
      replayed: true,
      event_type: null,
      provider_message_fingerprint: null,
      error_code: null,
      event_created_at: null,
    }]);
    const db = { execute } as unknown as Database;

    const result = await sendPreparedManualEmail(db, '00000000-0000-4000-8000-000000000205', auth, {
      sendEnabled: false,
      killSwitchEnabled: true,
      sender: '',
      fingerprintKey: '',
      deliver,
    });

    expect(result).toMatchObject({
      state: 'IN_PROGRESS',
      replayed: true,
      attemptId: '00000000-0000-4000-8000-000000000204',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('keeps a new send fail-closed when provider delivery is disabled', async () => {
    const deliver = vi.fn();
    const db = {
      execute: () => Promise.resolve([]),
    } as unknown as Database;

    await expect(sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000203',
      auth,
      {
        sendEnabled: false,
        killSwitchEnabled: true,
        sender: '',
        fingerprintKey: '',
        deliver,
      },
    )).rejects.toMatchObject({ code: 'EMAIL_CONSUMER_UNAVAILABLE' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not reject the send route before database replay and keeps unavailable delivery fail-closed', () => {
    const start = apiSource.indexOf(
      "app.post('/manual-message-preparations/:id/send'",
    );
    const end = apiSource.indexOf(
      "app.post('/manual-message-preparations/:id/whatsapp-cloud-send'",
      start,
    );
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = apiSource.slice(start, end);
    expect(section).toContain('sendPreparedManualEmail');
    expect(section).toContain('manualMessagingRoute');
    expect(section).not.toContain("code:'MANUAL_EMAIL_DISABLED'");
  });
});
