import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOperatorWhatsAppUrl,
  isSafeWhatsAppUrl,
  parseApiBaseUrl,
  parseOperatorPhone,
  resolveOperatorConsoleConfig,
  startOperatorTestConsole,
  validateOperatorPreparation,
} from './operator-test-console.js';

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

const FICTIONAL_E164 = '+12025550100';
const FICTIONAL_DIGITS = '12025550100';

const config = {
  LEAD_FINDER_API_URL: 'https://api.example.com',
  API_AUTH_TOKEN: 'x'.repeat(32),
  OPERATOR_TEST_AUTHORIZED: 'true',
  OPERATOR_TEST_WHATSAPP_E164: FICTIONAL_E164,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('operator test console', () => {
  it('allows HTTPS and loopback HTTP API URLs only', () => {
    expect(parseApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(parseApiBaseUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(() => parseApiBaseUrl('http://api.example.com')).toThrow(/HTTPS/);
    expect(() => parseApiBaseUrl('https://user:pass@api.example.com')).toThrow(/credentials/);
  });

  it('requires explicit authorization, API credentials and strict E.164', () => {
    expect(() => resolveOperatorConsoleConfig({})).toThrow(/AUTHORIZED/);
    expect(() => resolveOperatorConsoleConfig({
      ...config,
      API_AUTH_TOKEN: 'short',
    })).toThrow(/32 characters/);
    expect(() => parseOperatorPhone('202 555-0100')).toThrow(/E.164/);
    expect(resolveOperatorConsoleConfig(config).maskedPhone).toBe('••••0100');
  });

  it('creates only a canonical wa.me URL with the fixed local message', () => {
    const link = createOperatorWhatsAppUrl(FICTIONAL_E164, 'Teste interno');
    expect(link).toBe(`https://wa.me/${FICTIONAL_DIGITS}?text=Teste%20interno`);
    expect(isSafeWhatsAppUrl(link, 'Teste interno')).toBe(true);
    expect(isSafeWhatsAppUrl(`${link}&source=test`, 'Teste interno')).toBe(false);
  });

  it('accepts only the sanitized fixed preparation contract', () => {
    const value = {
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      purpose: 'OPERATOR_TEST',
      channel: 'WHATSAPP',
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      preparedAt: '2026-07-26T00:00:00.000Z',
      replayed: false,
    };
    expect(validateOperatorPreparation(value).purpose).toBe('OPERATOR_TEST');
    expect(() => validateOperatorPreparation({
      ...value,
      message: 'should never come from the API',
    })).toThrow('INVALID_OPERATOR_PREPARATION_RESPONSE');
    expect(() => validateOperatorPreparation({
      ...value,
      recipientFingerprint: 'a'.repeat(64),
    })).toThrow('INVALID_OPERATOR_PREPARATION_RESPONSE');
  });

  it('prepares, opens and confirms through the API while keeping phone and link local', async () => {
    const preparationId = 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b';
    const apiFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        preparationId,
        state: 'PREPARED',
        purpose: 'OPERATOR_TEST',
        channel: 'WHATSAPP',
        templateId: 'operator-whatsapp-channel-test',
        templateVersion: 'v1',
        preparedAt: '2026-07-26T00:00:00.000Z',
        replayed: false,
      }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ eventType: 'OPENED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        eventType: 'CONTACT_CONFIRMED',
        result: 'NOT_SENT',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const port = 43_000 + Math.floor(Math.random() * 5_000);
    const server = startOperatorTestConsole({
      ...config,
      OPERATOR_TEST_CONSOLE_PORT: String(port),
    });

    try {
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      const home = await localRequest(address.port, '/');
      expect(home.status).toBe(200);
      expect(home.body).toContain('••••0100');
      expect(home.body).not.toContain(FICTIONAL_DIGITS);
      expect(home.body).not.toContain('wa.me');

      const csrf = home.body.match(/name="csrf" value="([^"]+)"/)?.[1];
      expect(csrf).toBeTruthy();

      const prepared = await localRequest(
        address.port,
        '/prepare',
        'POST',
        new URLSearchParams({ csrf: csrf ?? '' }).toString(),
      );
      expect(prepared.status).toBe(200);
      expect(prepared.body).toContain(preparationId);
      expect(prepared.body).not.toContain(FICTIONAL_DIGITS);
      expect(prepared.body).not.toContain('wa.me');

      const prepareCall = apiFetch.mock.calls[0];
      expect(prepareCall?.[0]).toBe('https://api.example.com/operator-tests/whatsapp/preparations');
      expect(JSON.parse(String((prepareCall?.[1] as RequestInit | undefined)?.body))).toEqual({});

      const opened = await localRequest(
        address.port,
        '/open',
        'POST',
        new URLSearchParams({ csrf: csrf ?? '', preparationId }).toString(),
      );
      expect(opened.status).toBe(303);
      expect(opened.headers.location).toMatch(new RegExp(`^https://wa\\.me/${FICTIONAL_DIGITS}\\?text=`));
      expect(apiFetch.mock.calls[1]?.[0]).toBe(
        `https://api.example.com/operator-test-preparations/${preparationId}/open`,
      );

      const confirmed = await localRequest(
        address.port,
        '/confirm',
        'POST',
        new URLSearchParams({
          csrf: csrf ?? '',
          preparationId,
          result: 'NOT_SENT',
        }).toString(),
      );
      expect(confirmed.status).toBe(200);
      expect(confirmed.body).toContain('NOT_SENT');
      expect(apiFetch.mock.calls[2]?.[0]).toBe(
        `https://api.example.com/operator-test-preparations/${preparationId}/confirm`,
      );
      expect(apiFetch).toHaveBeenCalledTimes(3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails closed when the API returns sensitive or unexpected data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      purpose: 'OPERATOR_TEST',
      channel: 'WHATSAPP',
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      preparedAt: '2026-07-26T00:00:00.000Z',
      replayed: false,
      link: `https://wa.me/${FICTIONAL_DIGITS}?text=unexpected`,
    }), { status: 201, headers: { 'content-type': 'application/json' } }));

    const port = 48_000 + Math.floor(Math.random() * 5_000);
    const server = startOperatorTestConsole({
      ...config,
      OPERATOR_TEST_CONSOLE_PORT: String(port),
    });

    try {
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      const home = await localRequest(address.port, '/');
      const csrf = home.body.match(/name="csrf" value="([^"]+)"/)?.[1];
      const response = await localRequest(
        address.port,
        '/prepare',
        'POST',
        new URLSearchParams({ csrf: csrf ?? '' }).toString(),
      );
      expect(response.status).toBe(422);
      expect(response.body).toContain('INVALID_OPERATOR_PREPARATION_RESPONSE');
      expect(response.body).not.toContain(`wa.me/${FICTIONAL_DIGITS}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
