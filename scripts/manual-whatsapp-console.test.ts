import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorTestWhatsAppUrl,
  escapeHtml,
  isSafeWhatsAppUrl,
  operatorTestConfig,
  parseApiBaseUrl,
  parseOperatorTestPhone,
  resolveApiConfig,
  startManualWhatsAppConsole,
  validatePreparation,
} from './manual-whatsapp-console.js';

type LocalResponse = Readonly<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}>;

const localRequest = (
  port: number,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body = '',
): Promise<LocalResponse> => new Promise((resolve, reject) => {
  const req = request({
    host: '127.0.0.1',
    port,
    path,
    method,
    headers: body
      ? {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        }
      : undefined,
  }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    response.on('end', () => resolve({
      status: response.statusCode ?? 0,
      headers: response.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

describe('manual WhatsApp operator console', () => {
  it('allows HTTPS and loopback HTTP API URLs only', () => {
    expect(parseApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(parseApiBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(() => parseApiBaseUrl('http://api.example.com')).toThrow(/HTTPS/);
    expect(() => parseApiBaseUrl('https://user:pass@api.example.com')).toThrow(/credentials/);
  });

  it('loads API credentials only when the pilot mode is configured', () => {
    expect(resolveApiConfig({})).toBeUndefined();
    expect(() => resolveApiConfig({ API_AUTH_TOKEN: 'x'.repeat(32) })).toThrow(/LEAD_FINDER_API_URL/);
    expect(() => resolveApiConfig({ LEAD_FINDER_API_URL: 'https://api.example.com' })).toThrow(/32 characters/);
    expect(resolveApiConfig({
      LEAD_FINDER_API_URL: 'https://api.example.com/',
      API_AUTH_TOKEN: 'x'.repeat(32),
    })?.baseUrl).toBe('https://api.example.com');
  });

  it('accepts only a canonical wa.me destination with exactly the displayed message', () => {
    expect(isSafeWhatsAppUrl(
      'https://wa.me/5519971519337?text=Ol%C3%A1',
      'Olá',
    )).toBe(true);
    expect(isSafeWhatsAppUrl(
      'https://wa.me/5519971519337?text=Outro',
      'Olá',
    )).toBe(false);
    expect(isSafeWhatsAppUrl(
      'https://wa.me/5519971519337?text=Ol%C3%A1&source=test',
      'Olá',
    )).toBe(false);
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
    expect(isSafeWhatsAppUrl(link, 'Teste interno')).toBe(true);
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

  it('rejects a preparation whose link text differs from the displayed message', () => {
    expect(() => validatePreparation({
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      channel: 'WHATSAPP',
      templateId: 'pilot-whatsapp-first-contact',
      templateVersion: 'v1',
      message: 'Texto exibido',
      link: 'https://wa.me/5519971519337?text=Outro%20texto',
      replayed: false,
    })).toThrow('INVALID_PREPARATION_RESPONSE');
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

  it('starts in operator-only mode without loading API credentials', async () => {
    const port = 43_000 + Math.floor(Math.random() * 5_000);
    const apiFetch = vi.spyOn(globalThis, 'fetch');
    const server = startManualWhatsAppConsole({
      MANUAL_WHATSAPP_CONSOLE_PORT: String(port),
      OPERATOR_TEST_AUTHORIZED: 'true',
      OPERATOR_TEST_WHATSAPP_E164: '+5519971519337',
    });

    try {
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      const home = await localRequest(address.port, '/');
      expect(home.status).toBe(200);
      expect(home.body).toContain('Fluxo de piloto desativado');
      expect(home.body).not.toContain('Pilot Run ID');

      const csrf = home.body.match(/name="csrf" value="([^"]+)"/)?.[1];
      expect(csrf).toBeTruthy();
      const opened = await localRequest(
        address.port,
        '/operator-test/open',
        'POST',
        new URLSearchParams({ csrf: csrf ?? '' }).toString(),
      );
      expect(opened.status).toBe(303);
      expect(opened.headers.location).toMatch(/^https:\/\/wa\.me\/5519971519337\?text=/);
      expect(apiFetch).not.toHaveBeenCalled();
    } finally {
      apiFetch.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('escapes locally rendered message content', () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;',
    );
  });
});
