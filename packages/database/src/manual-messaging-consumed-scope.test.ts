import { describe, expect, it } from 'vitest';
import {
  isConsumedWhatsappTestScopeConstraint,
  getWhatsappCloudSendScopeStatus,
  ManualMessagingError,
  resolveWhatsAppCloudSendScope,
  WHATSAPP_CONSUMED_SCOPE_CONSTRAINT,
} from './manual-messaging.js';

describe('consumed WhatsApp Cloud scope errors', () => {
  it.each([
    [{ code: '23505', constraint: WHATSAPP_CONSUMED_SCOPE_CONSTRAINT }],
    [{ code: '23505', constraint_name: WHATSAPP_CONSUMED_SCOPE_CONSTRAINT }],
    [{ cause: { code: '23505', constraint: WHATSAPP_CONSUMED_SCOPE_CONSTRAINT } }],
    [{ cause: { cause: { code: '23505', constraint_name: WHATSAPP_CONSUMED_SCOPE_CONSTRAINT } } }],
  ])('recognizes the allowlisted scope uniqueness violation', (error) => {
    expect(isConsumedWhatsappTestScopeConstraint(error)).toBe(true);
  });

  it.each([
    [{ code: '23505', constraint: 'pilot_manual_whatsapp_cloud_send_attempts_preparation_id_key' }],
    [{ code: '23505', constraint: 'unrelated_unique_constraint' }],
    [{ code: '23505' }],
    [{ code: '40001', constraint: WHATSAPP_CONSUMED_SCOPE_CONSTRAINT }],
    [new Error('synthetic failure')],
    [null],
    [undefined],
  ])('does not mask unrelated or incomplete database errors', (error) => {
    expect(isConsumedWhatsappTestScopeConstraint(error)).toBe(false);
  });

  it('exposes a stable domain code without database details', () => {
    const error = new ManualMessagingError(
      'WhatsApp Cloud test scope has already been consumed',
      'WHATSAPP_TEST_SCOPE_CONSUMED',
    );
    expect(error).toMatchObject({ code: 'WHATSAPP_TEST_SCOPE_CONSUMED' });
    expect(error.message).not.toContain('23505');
    expect(error.message).not.toContain(WHATSAPP_CONSUMED_SCOPE_CONSTRAINT);
  });

  it('resolves only server-side allowlisted scopes', () => {
    expect(resolveWhatsAppCloudSendScope(undefined)).toBe('HML_TEST_002');
    expect(resolveWhatsAppCloudSendScope('HML_TEST')).toBe('HML_TEST');
    expect(() => resolveWhatsAppCloudSendScope('client-selected-scope')).toThrow('WHATSAPP_CLOUD_SCOPE_CONFIGURATION_INVALID');
  });

  it.each(['CONSUMED', 'AVAILABLE', 'UNKNOWN'] as const)('returns the sanitized %s preflight status', async (status) => {
    const db = { execute: () => Promise.resolve([{ status }]) } as never;
    await expect(getWhatsappCloudSendScopeStatus(db, 'HML_TEST_002')).resolves.toBe(status);
  });

  it('fails closed when the read-only status function returns an invalid value', async () => {
    const db = { execute: () => Promise.resolve([{ status: 'PII' }]) } as never;
    await expect(getWhatsappCloudSendScopeStatus(db, 'HML_TEST_002')).rejects.toThrow('WHATSAPP_CLOUD_SCOPE_STATUS_UNAVAILABLE');
  });
});
