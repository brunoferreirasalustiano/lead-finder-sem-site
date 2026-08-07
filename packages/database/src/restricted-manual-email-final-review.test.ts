import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAuthorizationContext } from '@lead-finder/shared';
import type { Database } from './index.js';
import { prepareManualMessage } from './restricted-manual-email.js';

const migration = readFileSync(
  new URL('../../../database/migrations/0047_restricted_manual_email_final_review.sql', import.meta.url),
  'utf8',
);

describe('restricted manual email final review migration', () => {
  it('does not let observers terminalize an unresolved attempt on lease expiry', () => {
    expect(migration).not.toContain('RESERVATION_WITHOUT_TERMINAL_EVENT');
    expect(migration).not.toContain('lease_expires_at <= clock_timestamp()');
    expect(migration).toContain('existing_event.event_type');
  });

  it('acquires the shared lifecycle lock before restricted and row locks', () => {
    const start = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.append_manual_email_open_event(',
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const openFunction = migration.slice(start);
    const lifecycleLock = openFunction.indexOf("'manual-message-preparation:'");
    const restrictedLock = openFunction.indexOf("'manual-email-preparation:'");
    const rowLock = openFunction.indexOf('FOR UPDATE');
    expect(lifecycleLock).toBeGreaterThanOrEqual(0);
    expect(restrictedLock).toBeGreaterThan(lifecycleLock);
    expect(rowLock).toBeGreaterThan(restrictedLock);
  });
});

describe('restricted manual email preparation replay', () => {
  it('returns persisted fingerprints for a historical V1 replay', async () => {
    const currentContactFingerprint = 'a'.repeat(64);
    const persistedContactFingerprint = 'b'.repeat(64);
    const persistedMessageFingerprint = 'c'.repeat(64);
    const preparationId = '00000000-0000-4000-8000-000000000001';
    const pilotRunId = '00000000-0000-4000-8000-000000000002';
    const leadId = '00000000-0000-4000-8000-000000000003';
    const contactId = '00000000-0000-4000-8000-000000000004';
    const preparedAt = new Date('2026-08-07T12:00:00.000Z');
    const expiresAt = new Date('2026-08-08T12:00:00.000Z');
    const responses: unknown[][] = [
      [{
        contact_fingerprint: currentContactFingerprint,
        contact_source: 'PUBLIC_BUSINESS_SOURCE',
        lead_name: 'Empresa atual',
      }],
      [{
        id: preparationId,
        prepared_at: preparedAt,
        expires_at: expiresAt,
        result_snapshot: {
          channel: 'EMAIL',
          templateId: 'pilot-email-first-contact',
          templateVersion: 'v1',
          variables: {
            EMPRESA: 'Empresa histórica',
            FONTE: 'PUBLIC_BUSINESS_SOURCE',
          },
          contactFingerprint: persistedContactFingerprint,
          messageFingerprint: persistedMessageFingerprint,
        },
        replayed: true,
      }],
    ];
    const tx = {
      execute: async () => responses.shift() ?? [],
    };
    const db = {
      transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>) => operation(tx),
    } as unknown as Database;
    const auth = createAuthorizationContext({
      principalId: 'restricted-email-operator-test',
      permissions: new Set([
        'manual-messaging:prepare',
        'manual-messaging:open',
        'manual-messaging:send',
      ]),
      authenticationMethod: 'unit-test',
    });

    const result = await prepareManualMessage(
      db,
      pilotRunId,
      leadId,
      {
        contactId,
        requestedChannel: 'EMAIL',
        templateId: 'pilot-email-first-contact',
        templateVersion: 'v1',
        idempotencyKey: 'historical-v1-replay-key-0001',
      },
      auth,
    );

    expect(result).toMatchObject({
      preparationId,
      replayed: true,
      contactFingerprint: persistedContactFingerprint,
      messageFingerprint: persistedMessageFingerprint,
      preparedAt,
      expiresAt,
    });
    expect(result).not.toMatchObject({ contactFingerprint: currentContactFingerprint });
  });
});
