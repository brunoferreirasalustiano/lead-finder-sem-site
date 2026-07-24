import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  isSafeWhatsAppUrl,
  parseApiBaseUrl,
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
