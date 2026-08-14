import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { approvedTemplates, DeterministicFakeMessagingProvider } from '@lead-finder/messaging';
import { createAuthorizationContext } from '@lead-finder/shared';
import { recordManualOpen, type Database } from './index.js';
import { sendPreparedManualEmail } from './restricted-manual-email.js';

const databaseIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(
  new URL('../../../apps/api/src/app.ts', import.meta.url),
  'utf8',
);
const restrictedEmailSource = readFileSync(
  new URL('./restricted-manual-email.ts', import.meta.url),
  'utf8',
);
const authSource = readFileSync(
  new URL('../../../apps/api/src/auth.ts', import.meta.url),
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
const daily6Auth = createAuthorizationContext({
  principalId: 'daily6-reconciliation-test',
  permissions: new Set(['daily6:send']),
  authenticationMethod: 'unit-test',
});

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};
const digest = (value: unknown) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');

const newDaily6Fixture = () => {
  const variables = { EMPRESA: 'Synthetic Lead', FONTE: 'synthetic-source' };
  const prepared = new DeterministicFakeMessagingProvider().prepare(approvedTemplates.emailV2, variables);
  const snapshot = {
    schemaVersion: 2,
    channel: 'EMAIL',
    templateId: approvedTemplates.emailV2.id,
    templateVersion: approvedTemplates.emailV2.version,
    variables: {},
    renderedInputsFingerprint: digest(variables),
    contactFingerprint: 'c'.repeat(64),
    messageFingerprint: prepared.fingerprint,
  };
  const context = {
    pilot_run_id: '00000000-0000-4000-8000-000000000301',
    lead_id: '00000000-0000-4000-8000-000000000302',
    contact_id: '00000000-0000-4000-8000-000000000303',
    template_id: approvedTemplates.emailV2.id,
    template_version: approvedTemplates.emailV2.version,
    result_fingerprint: digest(snapshot),
    result_snapshot: snapshot,
    contact_value: 'lead@example.test',
    contact_fingerprint: 'c'.repeat(64),
    contact_source: 'synthetic-source',
    lead_name: 'Synthetic Lead',
    expires_at: new Date('2026-08-13T12:00:00.000Z'),
  };
  const attempt = {
    id: '00000000-0000-4000-8000-000000000304',
    reserved_at: new Date('2026-08-13T12:00:00.000Z'),
    replayed: false,
    event_type: null,
    provider_message_fingerprint: null,
    error_code: null,
    event_created_at: null,
  };
  return { context, attempt };
};

const daily6Runtime = (searchSent: (input: { deliveryKey: string }) => Promise<{ state: 'FOUND' | 'NOT_FOUND' | 'UNKNOWN'; messageId?: string }>) => ({
  sendEnabled: true,
  killSwitchEnabled: false,
  sender: 'leadfinderbrasil@gmail.com',
  fingerprintKey: 'f'.repeat(32),
  deliver: vi.fn().mockResolvedValue({ provider: 'GMAIL_API', messageId: 'provider-message' }),
  daily6: {
    batchId: '2026-08-13|09|campinas-sp|daily6-v1',
    sendIdentity: '2026-08-13|09|campinas-sp|daily6-v1|lead-1',
    searchSent,
  },
});

// Revalidate P2-A/P2-B against the current HML email principal and runtime baseline.
describe('PR 223 restricted manual email follow-ups', () => {
  it('dispatches OPEN by open permission instead of send permission', () => {
    const start = databaseIndex.indexOf('export async function recordManualOpen(');
    const end = databaseIndex.indexOf('export async function checkDatabase', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = databaseIndex.slice(start, end);
    expect(section).toContain("auth.permissions.has('manual-messaging:open')");
    expect(section).not.toContain("auth.permissions.has('manual-messaging:send')");
    expect(section).not.toContain('recordLegacyManualOpen');
  });

  it.each([false, true])(
    'fails closed before database dispatch when OPEN permission is absent (send=%s)',
    async (sendEnabled) => {
    const execute = vi.fn();
    const transaction = vi.fn();
    const db = { execute, transaction } as unknown as Database;
    const unauthorized = createAuthorizationContext({
      principalId: `restricted-email-pr223-${sendEnabled ? 'send' : 'no-send'}`,
      permissions: new Set(sendEnabled ? ['manual-messaging:send'] : []),
      authenticationMethod: 'unit-test',
    });

    await expect(recordManualOpen(
      db,
      '00000000-0000-4000-8000-000000000206',
      { idempotencyKey: `pr223-open-permission-denied-${sendEnabled}` },
      unauthorized,
    )).rejects.toThrow('MANUAL_MESSAGING_OPEN_PERMISSION_REQUIRED');
    expect(execute).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('keeps non-email OPEN on the legacy channel path', () => {
    const start = restrictedEmailSource.indexOf('export async function recordManualOpen(');
    const end = restrictedEmailSource.indexOf('const terminalResult', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = restrictedEmailSource.slice(start, end);
    expect(section).toContain('const code = postgresCode(error);');
    expect(section).toContain("code === '42809' || code === '42883'");
    expect(section).toContain('recordLegacyManualOpen(db, preparationId, input, auth)');
  });

  it('protects the OPEN route with the dedicated open permission', () => {
    expect(authSource).toContain(
      "policy('POST', '/manual-message-preparations/:id/open', 'manual-messaging:open')",
    );
  });

  it('uses the dedicated Daily-6 permission for the quota-bound send route', async () => {
    expect(authSource).toContain(
      "policy('POST', '/daily6/manual-message-preparations/:id/send', 'daily6:send')",
    );
    expect(restrictedEmailSource).toContain(
      "requirePermission(auth, runtime.daily6 ? 'daily6:send' : 'manual-messaging:send')",
    );

    const execute = vi.fn();
    const db = { execute } as unknown as Database;
    const unauthorized = createAuthorizationContext({
      principalId: 'daily6-without-permission',
      permissions: new Set(),
      authenticationMethod: 'unit-test',
    });
    await expect(sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000207',
      unauthorized,
      {
        sendEnabled: true,
        killSwitchEnabled: false,
        sender: 'sender@example.test',
        fingerprintKey: 'f'.repeat(32),
        deliver: vi.fn(),
        daily6: {
          batchId: '2026-08-12|09|campinas-sp|daily6-v1',
          sendIdentity: '2026-08-12|09|campinas-sp|daily6-v1|lead-1',
          searchSent: vi.fn(),
        },
      },
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

  it('reconciles a Gmail SENT hit as DELIVERED without calling the provider send', async () => {
    const fixture = newDaily6Fixture();
    const searchSent = vi.fn().mockResolvedValue({ state: 'FOUND', messageId: 'gmail-message-id' });
    const runtime = daily6Runtime(searchSent);
    const txExecute = vi.fn()
      .mockResolvedValueOnce([fixture.context])
      .mockResolvedValueOnce([fixture.attempt])
      .mockResolvedValueOnce([{ reserved: true, replayed: false, reason: 'RESERVED' }]);
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: fixture.attempt.id,
        event_type: 'DELIVERED',
        provider_message_fingerprint: 'd'.repeat(64),
        error_code: null,
        created_at: new Date('2026-08-13T12:00:01.000Z'),
        replayed: false,
      }])
      .mockResolvedValueOnce([]);
    const db = {
      execute,
      transaction: vi.fn((callback: (tx: { execute: typeof txExecute }) => unknown) => callback({ execute: txExecute })),
    } as unknown as Database;

    const result = await sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000305',
      daily6Auth,
      runtime,
    );

    expect(result.state).toBe('DELIVERED');
    expect(runtime.deliver).not.toHaveBeenCalled();
    expect(searchSent).toHaveBeenCalledTimes(1);
    const searchRequest = searchSent.mock.calls[0]?.[0] as { deliveryKey?: unknown } | undefined;
    expect(searchRequest?.deliveryKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(searchRequest).not.toHaveProperty('recipient');
  });

  it('marks Gmail SENT search UNKNOWN as terminal AMBIGUOUS with SEND_RETRY=0', async () => {
    const fixture = newDaily6Fixture();
    const searchSent = vi.fn().mockResolvedValue({ state: 'UNKNOWN' });
    const runtime = daily6Runtime(searchSent);
    const txExecute = vi.fn()
      .mockResolvedValueOnce([fixture.context])
      .mockResolvedValueOnce([fixture.attempt])
      .mockResolvedValueOnce([{ reserved: true, replayed: false, reason: 'RESERVED' }]);
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: fixture.attempt.id,
        event_type: 'AMBIGUOUS',
        provider_message_fingerprint: null,
        error_code: 'GMAIL_SENT_SEARCH_UNKNOWN',
        created_at: new Date('2026-08-13T12:00:01.000Z'),
        replayed: false,
      }])
      .mockResolvedValueOnce([]);
    const db = {
      execute,
      transaction: vi.fn((callback: (tx: { execute: typeof txExecute }) => unknown) => callback({ execute: txExecute })),
    } as unknown as Database;

    const result = await sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000306',
      daily6Auth,
      runtime,
    );

    expect(result).toMatchObject({ state: 'AMBIGUOUS', errorCode: 'GMAIL_SENT_SEARCH_UNKNOWN' });
    expect(runtime.deliver).not.toHaveBeenCalled();
    expect(searchSent).toHaveBeenCalledTimes(1);
  });

  it('reconciles an existing IN_PROGRESS attempt before returning it', async () => {
    const searchSent = vi.fn().mockResolvedValue({ state: 'FOUND', messageId: 'gmail-replayed-id' });
    const runtime = daily6Runtime(searchSent);
    const execute = vi.fn()
      .mockResolvedValueOnce([{
        id: '00000000-0000-4000-8000-000000000307',
        reserved_at: new Date('2026-08-13T12:00:00.000Z'),
        replayed: true,
        event_type: null,
        provider_message_fingerprint: null,
        error_code: null,
        event_created_at: null,
      }])
      .mockResolvedValueOnce([{
        id: '00000000-0000-4000-8000-000000000307',
        event_type: 'DELIVERED',
        provider_message_fingerprint: 'd'.repeat(64),
        error_code: null,
        created_at: new Date('2026-08-13T12:00:01.000Z'),
        replayed: false,
      }])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as Database;

    const result = await sendPreparedManualEmail(
      db,
      '00000000-0000-4000-8000-000000000308',
      daily6Auth,
      runtime,
    );

    expect(result).toMatchObject({ state: 'DELIVERED', replayed: true });
    expect(searchSent).toHaveBeenCalledTimes(1);
    expect(runtime.deliver).not.toHaveBeenCalled();
  });
});
