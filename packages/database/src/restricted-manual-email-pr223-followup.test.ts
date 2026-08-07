import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
import { sendPreparedManualEmail } from './restricted-manual-email.js';

const databaseIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(
  new URL('../../../apps/api/src/app.ts', import.meta.url),
  'utf8',
);
const legacyCompatibility = readFileSync(
  new URL(
    '../../../database/migrations/0044_manual_email_historical_snapshot_compatibility.sql',
    import.meta.url,
  ),
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
  it('dispatches OPEN by open permission instead of send permission', () => {
    const start = databaseIndex.indexOf('export async function recordManualOpen(');
    const end = databaseIndex.indexOf('export async function checkDatabase', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const section = databaseIndex.slice(start, end);
    expect(section).toContain("auth.permissions.has('manual-messaging:open')");
    expect(section).not.toContain("auth.permissions.has('manual-messaging:send')");
  });

  it('lets the database replay a persisted terminal send while provider delivery is disabled', async () => {
    const attemptId = '00000000-0000-4000-8000-000000000201';
    const deliver = vi.fn();
    const db = {
      execute: () => Promise.resolve([{
        id: attemptId,
        reserved_at: new Date('2026-08-07T12:00:00.000Z'),
        replayed: true,
        event_type: 'DELIVERED',
        provider_message_fingerprint: 'd'.repeat(64),
        error_code: null,
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
      state: 'DELIVERED',
      provider: 'GMAIL_API',
      replayed: true,
      attemptId,
      messageIdFingerprint: 'd'.repeat(64),
    });
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

  it('does not reject the send route before database replay and maps unavailable delivery to 503', () => {
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
    expect(section).not.toContain("code:'MANUAL_EMAIL_DISABLED'");
    expect(apiSource).toContain("error.code==='EMAIL_CONSUMER_UNAVAILABLE'");
  });

  it('preserves non-sensitive V1 extensions while keeping V2 exact and forbidden keys blocked', () => {
    const v1Start = legacyCompatibility.indexOf("template_version = 'v1'");
    const v2Start = legacyCompatibility.indexOf("template_version = 'v2'");
    expect(v1Start).toBeGreaterThanOrEqual(0);
    expect(v2Start).toBeGreaterThan(v1Start);

    const v1 = legacyCompatibility.slice(v1Start, v2Start);
    const v2 = legacyCompatibility.slice(v2Start);
    expect(v1).not.toContain('result_snapshot - ARRAY[');
    expect(v2).toContain('result_snapshot - ARRAY[');
    expect(legacyCompatibility).toContain(
      "NOT (result_snapshot ?| ARRAY['message','subject','link','url','contactValue'])",
    );
  });
});
