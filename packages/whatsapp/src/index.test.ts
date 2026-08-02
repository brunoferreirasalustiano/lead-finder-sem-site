import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppCloudApiClient, createWhatsAppManualUrl, FakeWhatsAppProvider, normalizePhoneE164, WhatsAppCloudApiError } from './index.js';

const phoneNumberId = '123456789012345';
const accessToken = 'synthetic-cloud-access-token-012345678901234567890123';
const FICTIONAL_NANPA_NUMBER = '+12025550100';

describe('phone', () => {
  it.each([
    ['+55 (11) 90000-0000', '+5511900000000'],
    ['(11) 90000-0000', '+5511900000000'],
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
      ok: true, e164: '+555532221234', digits: '555532221234',
    }));
  it('accepts an explicitly international number', () =>
    expect(normalizePhoneE164('+14155552671')).toMatchObject({ ok: true, e164: '+14155552671' }));
  it.each([undefined, '123', '12345678901234567890', 'javascript:alert(1)'])('rejects %s', (input) =>
    expect(normalizePhoneE164(input)).toMatchObject({ ok: false }));
  it('encodes URL content with a fictional reserved number', () =>
    expect(createWhatsAppManualUrl(FICTIONAL_NANPA_NUMBER, 'Olá & teste?')).toBe(
      'https://wa.me/12025550100?text=Ol%C3%A1%20%26%20teste%3F',
    ));
  it('generates the correct wa.me destination for national DDD 55', () =>
    expect(createWhatsAppManualUrl('55 9 9123-4567', 'teste')).toBe('https://wa.me/5555991234567?text=teste'));
  it('never sends', () =>
    expect(new FakeWhatsAppProvider().prepare(FICTIONAL_NANPA_NUMBER, 'teste')).toMatchObject({ networkCalls: 0, sent: false }));
});

describe('WhatsApp Cloud API client', () => {
  it('sends a text message to the fixed Graph API host and returns only the provider id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: 'wamid.synthetic-message-1' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const client = createWhatsAppCloudApiClient({ phoneNumberId, accessToken, fetchImpl });

    await expect(client.sendText({ recipient: '+5519971519337', body: 'TESTE INTERNO' }))
      .resolves.toEqual({ provider: 'WHATSAPP_CLOUD_API', messageId: 'wamid.synthetic-message-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl.mock.calls as unknown as Array<[string | URL, RequestInit | undefined]>)[0]!;
    expect(url).toBe(`https://graph.facebook.com/v23.0/${phoneNumberId}/messages`);
    expect(init).toMatchObject({ method: 'POST' });
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    });
    const body = (init as RequestInit).body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5519971519337',
      type: 'text',
      text: { preview_url: false, body: 'TESTE INTERNO' },
    });
  });

  it('does not expose provider response bodies or the access token in errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'token-secret-and-phone-+5511999999999' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    const client = createWhatsAppCloudApiClient({ phoneNumberId, accessToken, fetchImpl });

    const error = await client.sendText({ recipient: '+5519971519337', body: 'TESTE' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(WhatsAppCloudApiError);
    expect(String(error)).not.toContain(accessToken);
    expect(String(error)).not.toContain('token-secret');
    expect(String(error)).not.toContain('+5511999999999');
  });

  it.each([
    ['invalid phone number', { recipient: 'not-a-phone', body: 'TESTE' }],
    ['empty body', { recipient: '+5519971519337', body: '' }],
    ['oversized body', { recipient: '+5519971519337', body: 'x'.repeat(4097) }],
  ])('rejects %s before network access', async (_name, message) => {
    const fetchImpl = vi.fn();
    const client = createWhatsAppCloudApiClient({ phoneNumberId, accessToken, fetchImpl });
    await expect(client.sendText(message)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed for malformed provider responses and network errors', async () => {
    const malformed = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const network = vi.fn().mockRejectedValue(new Error('secret network detail'));
    const malformedClient = createWhatsAppCloudApiClient({ phoneNumberId, accessToken, fetchImpl: malformed });
    const networkClient = createWhatsAppCloudApiClient({ phoneNumberId, accessToken, fetchImpl: network });
    await expect(malformedClient.sendText({ recipient: '+5519971519337', body: 'TESTE' }))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    await expect(networkClient.sendText({ recipient: '+5519971519337', body: 'TESTE' }))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
