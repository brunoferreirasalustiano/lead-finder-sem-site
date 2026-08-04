import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvedTemplates } from '@lead-finder/messaging';
import {
  createOperatorPrincipalBinding,
  createOperatorRecipientReceipt,
  digestOperatorTestMessage,
  OPERATOR_RECIPIENT_BINDING_VERSION,
} from '@lead-finder/shared';
import {
  createOperatorWhatsAppUrl,
  isSafeWhatsAppUrl,
  parseApiBaseUrl,
  parseOperatorPhone,
  resolveOperatorConsoleConfig,
  startOperatorTestConsole,
  validateOperatorPreparationReceipt,
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
const BINDING_KEY = 'operator-test-recipient-binding-key-0001';

const config = {
  LEAD_FINDER_API_URL: 'https://api.example.com',
  API_AUTH_TOKEN: 'x'.repeat(32),
  OPERATOR_TEST_AUTHORIZED: 'true',
  OPERATOR_TEST_WHATSAPP_E164: FICTIONAL_E164,
  OPERATOR_TEST_RECIPIENT_BINDING_KEY: BINDING_KEY,
};

const responseForPreparationRequest = (
  init: RequestInit | undefined,
  overrides: Record<string, unknown> = {},
  receiptKey = BINDING_KEY,
) => {
  const requestBody = JSON.parse(String(init?.body)) as {
    bindingVersion: string;
    bindingNonce: string;
  };
  const headers = init?.headers as Record<string, string>;
  const idempotencyKey = headers['idempotency-key'];
  const preparationId = 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b';
  const principalBinding = createOperatorPrincipalBinding(receiptKey, {
    bindingVersion: requestBody.bindingVersion,
    bindingNonce: requestBody.bindingNonce,
    principalId: 'operator-bruno',
  });
  const recipientBindingReceipt = createOperatorRecipientReceipt(receiptKey, {
    bindingVersion: requestBody.bindingVersion,
    bindingNonce: requestBody.bindingNonce,
    idempotencyKey,
    preparationId,
    recipientE164: FICTIONAL_E164,
    templateId: 'operator-whatsapp-channel-test',
    templateVersion: 'v1',
    messageDigest: digestOperatorTestMessage(approvedTemplates.operatorWhatsappTestV1.body),
    principalBinding,
  });
  return {
    preparationId,
    state: 'PREPARED',
    purpose: 'OPERATOR_TEST',
    channel: 'WHATSAPP',
    templateId: 'operator-whatsapp-channel-test',
    templateVersion: 'v1',
    preparedAt: '2026-07-26T00:00:00.000Z',
    replayed: false,
    bindingVersion: requestBody.bindingVersion,
    bindingNonce: requestBody.bindingNonce,
    principalBinding,
    recipientBindingReceipt,
    ...overrides,
  };
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
    expect(() => resolveOperatorConsoleConfig({
      ...config,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: 'short',
    })).toThrow(/RECIPIENT_BINDING_KEY/);
    expect(() => resolveOperatorConsoleConfig({
      ...config,
      OPERATOR_TEST_RECIPIENT_BINDING_KEY: config.API_AUTH_TOKEN,
    })).toThrow(/differ from API_AUTH_TOKEN/);
    expect(() => resolveOperatorConsoleConfig({
      ...config,
      OPERATOR_TEST_FINGERPRINT_KEY: BINDING_KEY,
    })).toThrow(/differ from OPERATOR_TEST_FINGERPRINT_KEY/);
    expect(() => parseOperatorPhone('202 555-0100')).toThrow(/E.164/);
    expect(resolveOperatorConsoleConfig(config).maskedPhone).toBe('••••0100');
  });

  it('uses the API-approved template body for the local message and wa.me URL', () => {
    const message = approvedTemplates.operatorWhatsappTestV1.body;
    const resolved = resolveOperatorConsoleConfig(config);
    const link = createOperatorWhatsAppUrl(FICTIONAL_E164);
    expect(resolved.message).toBe(message);
    expect(link).toBe(`https://wa.me/${FICTIONAL_DIGITS}?text=${encodeURIComponent(message)}`);
    expect(isSafeWhatsAppUrl(link, message)).toBe(true);
    expect(isSafeWhatsAppUrl(`${link}&source=test`, message)).toBe(false);
    expect(message).not.toContain('Não é necessário responder');
  });

  it('accepts only the strict operator preparation response contract', () => {
    const nonce = Buffer.alloc(32, 1).toString('base64url');
    const value = {
      preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
      state: 'PREPARED',
      purpose: 'OPERATOR_TEST',
      channel: 'WHATSAPP',
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      preparedAt: '2026-07-26T00:00:00.000Z',
      replayed: false,
      bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
      bindingNonce: nonce,
      principalBinding: Buffer.alloc(32, 2).toString('base64url'),
      recipientBindingReceipt: Buffer.alloc(32, 3).toString('base64url'),
    };
    expect(validateOperatorPreparation(value).purpose).toBe('OPERATOR_TEST');
    expect(validateOperatorPreparation(value).preparationId).toBe(value.preparationId);

    const invalidValues: unknown[] = [
      { ...value, preparationId: 'invalid-uuid' },
      { ...value, preparedAt: '0' },
      { ...value, preparedAt: 'July 26, 2026' },
      { ...value, preparedAt: '2026-02-30T00:00:00.000Z' },
      { ...value, message: 'should never come from the API' },
      { ...value, phone: FICTIONAL_E164 },
      { ...value, url: 'https://wa.me/example' },
      { ...value, link: 'https://wa.me/example' },
      { ...value, recipientFingerprint: 'a'.repeat(64) },
      { ...value, fingerprint: 'a'.repeat(64) },
      { ...value, templateId: 'different-template' },
      { ...value, templateVersion: 'v2' },
      { ...value, purpose: 'DIFFERENT_PURPOSE' },
      { ...value, channel: 'EMAIL' },
      { ...value, state: 'OPENED' },
      { ...value, replayed: 'false' },
      { ...value, bindingVersion: 'operator-recipient-binding-v2' },
      { ...value, bindingNonce: `${nonce}=` },
      { ...value, bindingNonce: Buffer.alloc(31).toString('base64url') },
      { ...value, recipientBindingReceipt: Buffer.alloc(33).toString('base64url') },
      { ...value, principalBinding: null },
      null,
      [],
      'invalid',
      1,
      true,
    ];
    for (const invalidValue of invalidValues) {
      expect(() => validateOperatorPreparation(invalidValue)).toThrow(
        'INVALID_OPERATOR_PREPARATION_RESPONSE',
      );
    }
  });

  it('shows the local link before open and keeps opening and confirmation explicit', async () => {
    const preparationId = 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b';
    const apiFetch = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_input, init) => Promise.resolve(new Response(JSON.stringify(
        responseForPreparationRequest(init),
      ), { status: 201, headers: { 'content-type': 'application/json' } })))
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
      expect(prepared.body).toContain(FICTIONAL_DIGITS);
      expect(prepared.body).toContain('wa.me');
      const localLink = prepared.body.match(
        /<a href="([^"]+)" target="_blank" rel="noopener noreferrer">Abrir WhatsApp manualmente<\/a>/,
      )?.[1];
      expect(localLink).toBeTruthy();
      expect(isSafeWhatsAppUrl(
        localLink ?? '',
        approvedTemplates.operatorWhatsappTestV1.body,
      )).toBe(true);
      expect(prepared.body).toContain('action="/open"');
      expect(prepared.body).toContain('Registrar que abri o WhatsApp');
      expect(prepared.body).not.toContain('Confirmar que enviei');
      expect(prepared.body).not.toContain('action="/confirm"');
      expect(apiFetch).toHaveBeenCalledTimes(1);

      const prepareCall = apiFetch.mock.calls[0];
      expect(prepareCall?.[0]).toBe('https://api.example.com/operator-tests/whatsapp/preparations');
      const prepareBody = JSON.parse(String((prepareCall?.[1] as RequestInit | undefined)?.body));
      expect(prepareBody).toEqual({
        bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
        bindingNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        recipientProof: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });

      const opened = await localRequest(
        address.port,
        '/open',
        'POST',
        new URLSearchParams({ csrf: csrf ?? '', preparationId }).toString(),
      );
      expect(opened.status).toBe(200);
      expect(opened.headers.location).toBeUndefined();
      expect(opened.body).toContain('OPENED_RECORDED=true');
      expect(opened.body).toContain('MESSAGE_SENT=false');
      expect(opened.body).toContain('Confirmar que enviei');
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
      for (const [, init] of apiFetch.mock.calls) {
        const requestBody = JSON.parse(String((init as RequestInit | undefined)?.body));
        expect(requestBody).not.toHaveProperty('phone');
        expect(requestBody).not.toHaveProperty('message');
        expect(requestBody).not.toHaveProperty('url');
        expect(requestBody).not.toHaveProperty('link');
      }
      expect(prepareBody).not.toHaveProperty('phone');
      expect(JSON.stringify(prepareBody)).not.toContain(FICTIONAL_DIGITS);
      expect((prepareCall?.[1] as RequestInit | undefined)?.headers).toHaveProperty('idempotency-key');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails closed when the API returns sensitive or unexpected data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => Promise.resolve(
      new Response(JSON.stringify(responseForPreparationRequest(init, {
        link: `https://wa.me/${FICTIONAL_DIGITS}?text=unexpected`,
      })), { status: 201, headers: { 'content-type': 'application/json' } }),
    ));

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

  it('rejects an invalid receipt before storing or calling open', async () => {
    const apiFetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) =>
      Promise.resolve(new Response(JSON.stringify(responseForPreparationRequest(
        init,
        {},
        'different-recipient-binding-key-0001',
      )), { status: 201, headers: { 'content-type': 'application/json' } })));
    const port = 53_000 + Math.floor(Math.random() * 5_000);
    const server = startOperatorTestConsole({
      ...config,
      OPERATOR_TEST_CONSOLE_PORT: String(port),
    });
    try {
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      const home = await localRequest(address.port, '/');
      const csrf = home.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
      const prepared = await localRequest(
        address.port,
        '/prepare',
        'POST',
        new URLSearchParams({ csrf }).toString(),
      );
      expect(prepared.status).toBe(422);
      expect(prepared.body).toContain('INVALID_OPERATOR_RECIPIENT_BINDING_RECEIPT');
      const opened = await localRequest(
        address.port,
        '/open',
        'POST',
        new URLSearchParams({
          csrf,
          preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
        }).toString(),
      );
      expect(opened.status).toBe(422);
      expect(opened.headers.location).toBeUndefined();
      const confirmed = await localRequest(
        address.port,
        '/confirm',
        'POST',
        new URLSearchParams({
          csrf,
          preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
          result: 'NOT_SENT',
        }).toString(),
      );
      expect(confirmed.status).toBe(422);
      const responded = await localRequest(
        address.port,
        '/response',
        'POST',
        new URLSearchParams({
          csrf,
          preparationId: 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b',
          result: 'NOT_RECEIVED',
        }).toString(),
      );
      expect(responded.status).toBe(422);
      expect(apiFetch).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('revalidates receipt fields and fails closed for every protected value', () => {
    const resolved = resolveOperatorConsoleConfig(config);
    const idempotencyKey = '11111111-1111-4111-8111-111111111111';
    const nonce = Buffer.alloc(32, 4).toString('base64url');
    const init = {
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
        bindingNonce: nonce,
      }),
    };
    const preparation = {
      ...responseForPreparationRequest(init),
      preparationIdempotencyKey: idempotencyKey,
      maskedPhone: '••••0100',
      message: resolved.message,
      link: resolved.link,
    };
    expect(() => validateOperatorPreparationReceipt(preparation, resolved)).not.toThrow();
    for (const mutation of [
      { preparationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { bindingNonce: Buffer.alloc(32, 5).toString('base64url') },
      { preparationIdempotencyKey: 'different-idempotency-key-0001' },
      { templateId: 'different-template' },
      { templateVersion: 'v2' },
      { principalBinding: Buffer.alloc(32, 6).toString('base64url') },
      { recipientBindingReceipt: Buffer.alloc(32, 7).toString('base64url') },
    ]) {
      expect(() => validateOperatorPreparationReceipt(
        { ...preparation, ...mutation },
        resolved,
      )).toThrow('INVALID_OPERATOR_RECIPIENT_BINDING_RECEIPT');
    }
  });
});
