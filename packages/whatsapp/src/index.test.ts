import { describe, expect, it } from 'vitest';
import { createWhatsAppManualUrl, FakeWhatsAppProvider, normalizePhoneE164 } from './index.js';
describe('phone', () => {
  it.each([
    ['+55 (19) 97151-9337', '+5519971519337'],
    ['(19) 97151-9337', '+5519971519337'],
    ['55 3222-1234', '+555532221234'],
    ['55 9 9123-4567', '+5555991234567'],
    ['+55 55 3222-1234', '+555532221234'],
    ['0055 55 9 9123-4567', '+5555991234567'],
    ['19 3222-1234', '+551932221234'],
  ])('normalizes %s', (input, expected) =>
    expect(normalizePhoneE164(input)).toMatchObject({ ok: true, e164: expected }),
  );
  it('does not interpret a national DDD 55 number as an incomplete international number', () =>
    expect(normalizePhoneE164('55 3222-1234')).toEqual({
      ok: true,
      e164: '+555532221234',
      digits: '555532221234',
    }));
  it('accepts an explicitly international number', () =>
    expect(normalizePhoneE164('+14155552671')).toMatchObject({
      ok: true,
      e164: '+14155552671',
    }));
  it.each([undefined, '123', '12345678901234567890', 'javascript:alert(1)'])(
    'rejects %s',
    (input) => expect(normalizePhoneE164(input)).toMatchObject({ ok: false }),
  );
  it('encodes URL content', () =>
    expect(createWhatsAppManualUrl('+5519971519337', 'Olá & teste?')).toBe(
      'https://wa.me/5519971519337?text=Ol%C3%A1%20%26%20teste%3F',
    ));
  it('generates the correct wa.me destination for national DDD 55', () =>
    expect(createWhatsAppManualUrl('55 9 9123-4567', 'teste')).toBe(
      'https://wa.me/5555991234567?text=teste',
    ));
  it('never sends', () =>
    expect(new FakeWhatsAppProvider().prepare('+5519971519337', 'teste')).toMatchObject({
      networkCalls: 0,
      sent: false,
    }));
});
