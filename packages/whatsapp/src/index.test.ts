import { describe, expect, it } from 'vitest';
import { createWhatsAppManualUrl, FakeWhatsAppProvider, normalizePhoneE164 } from './index.js';
describe('phone', () => {
  it.each([
    ['+55 (19) 97151-9337', '+5519971519337'],
    ['(19) 97151-9337', '+5519971519337'],
  ])('normalizes %s', (input, expected) =>
    expect(normalizePhoneE164(input)).toMatchObject({ ok: true, e164: expected }),
  );
  it.each([undefined, '123', '12345678901234567890', 'javascript:alert(1)'])(
    'rejects %s',
    (input) => expect(normalizePhoneE164(input)).toMatchObject({ ok: false }),
  );
  it('encodes URL content', () =>
    expect(createWhatsAppManualUrl('+5519971519337', 'Olá & teste?')).toBe(
      'https://wa.me/5519971519337?text=Ol%C3%A1%20%26%20teste%3F',
    ));
  it('never sends', () =>
    expect(new FakeWhatsAppProvider().prepare('+5519971519337', 'teste')).toMatchObject({
      networkCalls: 0,
      sent: false,
    }));
});
