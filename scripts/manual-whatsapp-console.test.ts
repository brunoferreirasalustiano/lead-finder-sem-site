import { describe, expect, it } from 'vitest';
import {
  createOperatorTestWhatsAppUrl,
  escapeHtml,
  isSafeWhatsAppUrl,
  operatorTestConfig,
  parseApiBaseUrl,
  parseOperatorTestPhone,
  validatePreparation,
} from './manual-whatsapp-console.js';

describe('manual WhatsApp operator console', () => {
  it('allows HTTPS and loopback HTTP API URLs only', () => {
    expect(parseApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(parseApiBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(() => parseApiBaseUrl('http://api.example.com')).toThrow(/HTTPS/);
    expect(() => parseApiBaseUrl('https://user:pass@api.example.com')).toThrow(/credentials/);
  });

  it('accepts only a canonical wa.me destination with message text', () => {
    expect(isSafeWhatsAppUrl('https://wa.me/5519971519337?text=Ol%C3%A1')).toBe(true);
    expect(isSafeWhatsAppUrl('https://example.com/5519971519337?text=Ol%C3%A1')).toBe(false);
    expect(isSafeWhatsAppUrl('http://wa.me/5519971519337?text=Ol%C3%A1')).toBe(false);
    expect(isSafeWhatsAppUrl('https://wa.me/5519971519337')).toBe(false);
  });

  it('requires strict E.164 for the operator-only number', () => {
    expect(parseOperatorTestPhone('+5519971519337')).toBe('+5519971519337');
    expect(() => parseOperatorTestPhone('19 97151-9337')).toThrow(/E.164/);
    expect(() => parseOperatorTestPhone('5519971519337')).toThrow(/E.164/);
  });

  it('creates a safe operator-only wa.me link without persisting the phone', () => {
    const link = createOperatorTestWhatsAppUrl('+5519971519337', 'Teste interno');
    expect(link).toBe('https://wa.me/5519971519337?text=Teste%20interno');
    expect(isSafeWhatsAppUrl(link)).toBe(true);
  });

  it('requires an explicit authorization flag for operator test mode', () => {
    expect(operatorTestConfig({})).toBeUndefined();
    expect(() => operatorTestConfig({
      OPERATOR_TEST_WHATSAPP_E164: '+5519971519337',
    })).toThrow(/AUTHORIZED/);
    expect(operatorTestConfig({
      OPERATOR_TEST_AUTHORIZED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '+5519971519337',
    })?.maskedPhone).toBe('••••9337');
  });

  it('validates a safe WhatsApp preparation response', () => {
    const preparation = validatePreparation({
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      channel: 'WHATSAPP',
      templateId: 'pilot-whatsapp-first-contact',
      templateVersion: 'v1',
      message: 'Teste',
      link: 'https://wa.me/5519971519337?text=Teste',
      replayed: false,
    });
    expect(preparation.channel).toBe('WHATSAPP');
  });

  it('rejects non-WhatsApp and unsafe preparation responses', () => {
    expect(() => validatePreparation({
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      channel: 'EMAIL',
      templateId: 'pilot-email-first-contact',
      templateVersion: 'v1',
      message: 'Teste',
      link: 'https://example.com',
      replayed: false,
    })).toThrow('INVALID_PREPARATION_RESPONSE');
  });

  it('escapes locally rendered message content', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;',
    );
  });
});