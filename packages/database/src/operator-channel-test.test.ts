import { describe, expect, it } from 'vitest';
import {
  buildOperatorTestPreparation,
  OperatorChannelTestError,
  resolveOperatorTestRecipient,
} from './operator-channel-test.js';

const enabledRuntime = {
  enabled: true,
  killSwitchEnabled: false,
  authorizedPhoneE164: '+5511999999999',
} as const;

describe('operator channel test runtime', () => {
  it('fails closed when the feature is disabled', () => {
    expect(() => resolveOperatorTestRecipient({
      ...enabledRuntime,
      enabled: false,
    })).toThrowError(expect.objectContaining<Partial<OperatorChannelTestError>>({
      code: 'DISABLED',
    }));
  });

  it('fails closed while the dedicated kill switch is engaged', () => {
    expect(() => resolveOperatorTestRecipient({
      ...enabledRuntime,
      killSwitchEnabled: true,
    })).toThrowError(expect.objectContaining<Partial<OperatorChannelTestError>>({
      code: 'KILL_SWITCH_ENGAGED',
    }));
  });

  it('rejects a missing or malformed operator recipient', () => {
    expect(() => resolveOperatorTestRecipient({
      enabled: true,
      killSwitchEnabled: false,
      authorizedPhoneE164: 'not-a-phone',
    })).toThrowError(expect.objectContaining<Partial<OperatorChannelTestError>>({
      code: 'INVALID_RECIPIENT',
    }));
  });

  it('builds the approved internal template and canonical wa.me link', () => {
    const result = buildOperatorTestPreparation(enabledRuntime);

    expect(result.template.id).toBe('operator-whatsapp-channel-test');
    expect(result.template.version).toBe('v1');
    expect(result.prepared.channel).toBe('WHATSAPP');
    expect(result.prepared.body).toContain('teste interno autorizado');
    expect(result.prepared.body).toContain('Nenhum lead real');
    expect(result.link).toMatch(/^https:\/\/wa\.me\/5511999999999\?text=/);
    expect(result.recipient.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses a stable recipient fingerprint without embedding the phone in it', () => {
    const first = resolveOperatorTestRecipient(enabledRuntime);
    const second = resolveOperatorTestRecipient(enabledRuntime);
    const other = resolveOperatorTestRecipient({
      ...enabledRuntime,
      authorizedPhoneE164: '+5511888888888',
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(other.fingerprint);
    expect(first.fingerprint).not.toContain('5511999999999');
  });
});
