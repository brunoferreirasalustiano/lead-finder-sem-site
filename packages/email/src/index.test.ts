import { describe, expect, it, vi } from 'vitest';
import {
  createGmailApiOperatorEmailConsumer,
  createGmailApiManualEmailConsumer,
  OperatorEmailDeliveryError,
  type OperatorEmailFetch,
} from './index.js';

const configuration = {
  sender: 'operator@example.test',
  recipient: 'operator@example.test',
  googleClientId: '123456789-synthetic.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-synthetic-client-secret',
  googleRefreshToken: '1//synthetic-refresh-token-value',
};

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'content-type': 'application/json' },
  },
);

const manualConsumer = (fetchMock: OperatorEmailFetch) =>
  createGmailApiManualEmailConsumer({
    sender: configuration.sender,
    googleClientId: configuration.googleClientId,
    googleClientSecret: configuration.googleClientSecret,
    googleRefreshToken: configuration.googleRefreshToken,
  }, fetchMock);

const manualMessage = {
  subject: 'Ideia para Empresa',
  body: 'Mensagem individual.',
  recipient: 'lead@example.test',
} as const;

describe('Gmail API operator email consumer', () => {
  it('exchanges the refresh token and sends one self-addressed MIME message', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'synthetic-access-token',
        token_type: 'Bearer',
        expires_in: 3_600,
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'synthetic-gmail-message-id',
        threadId: 'synthetic-thread-id',
      }));
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);
    const result = await consumer.sendInternalTest({
      subject: 'Teste interno de e-mail',
      body: 'Nenhum lead está envolvido.',
    });

    expect(result).toEqual({
      provider: 'GMAIL_API',
      messageId: 'synthetic-gmail-message-id',
      response: 'HTTP 200',
      outcome: 'PROVIDER_SUCCESS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall?.[0]).toBe('https://oauth2.googleapis.com/token');
    expect(tokenCall?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const tokenBody = tokenCall?.[1]?.body;
    expect(tokenBody).toBeInstanceOf(URLSearchParams);
    expect((tokenBody as URLSearchParams).get('client_id')).toBe(configuration.googleClientId);
    expect((tokenBody as URLSearchParams).get('client_secret')).toBe(configuration.googleClientSecret);
    expect((tokenBody as URLSearchParams).get('refresh_token')).toBe(configuration.googleRefreshToken);
    expect((tokenBody as URLSearchParams).get('grant_type')).toBe('refresh_token');

    const sendCall = fetchMock.mock.calls[1];
    expect(sendCall?.[0]).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    );
    expect(sendCall?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-access-token',
        'content-type': 'application/json',
      },
    });
    const requestBody = sendCall?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const request = JSON.parse(
      typeof requestBody === 'string' ? requestBody : '{}',
    ) as { raw: string };
    const mimeMessage = Buffer.from(request.raw, 'base64url').toString('utf8');
    expect(mimeMessage).toContain('From: operator@example.test');
    expect(mimeMessage).toContain('To: operator@example.test');
    expect(mimeMessage).toContain('X-Lead-Finder-Purpose: OPERATOR_TEST');
    expect(mimeMessage).toContain('Content-Transfer-Encoding: base64');
    const encodedBody = mimeMessage.split('\r\n\r\n')[1]?.replaceAll('\r\n', '');
    expect(Buffer.from(encodedBody ?? '', 'base64').toString('utf8')).toBe(
      'Nenhum lead está envolvido.',
    );
  });

  it('rejects a recipient different from the authenticated sender', () => {
    expect(() => createGmailApiOperatorEmailConsumer({
      ...configuration,
      recipient: 'lead@example.test',
    })).toThrow(OperatorEmailDeliveryError);
  });

  it('fails closed before Gmail when token exchange is rejected', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);

    await expect(consumer.sendInternalTest({
      subject: 'Internal test',
      body: 'No lead is involved.',
    })).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Gmail does not return a message identifier', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);

    await expect(consumer.sendInternalTest({
      subject: 'Internal test',
      body: 'No lead is involved.',
    })).rejects.toMatchObject({ code: 'DELIVERY_REJECTED' });
  });

  it('rejects header injection before any network request', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>();
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);

    await expect(consumer.sendInternalTest({
      subject: 'Internal test\r\nBcc: lead@example.test',
      body: 'No lead is involved.',
    })).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Gmail API manual email consumer', () => {
  it('searches only Gmail SENT with an opaque deterministic message id', async () => {
    const deliveryKey = 'a'.repeat(64);
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'synthetic-gmail-message-id' }] }));
    const result = await manualConsumer(fetchMock).searchSent({ deliveryKey });

    expect(result).toEqual({ state: 'FOUND', messageId: 'synthetic-gmail-message-id' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const searchCall = fetchMock.mock.calls[1];
    const searchInput = searchCall?.[0];
    const searchUrl = searchInput instanceof URL
      ? searchInput
      : new URL(typeof searchInput === 'string' ? searchInput : searchInput?.url ?? '');
    expect(searchUrl.pathname).toBe('/gmail/v1/users/me/messages');
    expect(searchUrl.searchParams.get('labelIds')).toBe('SENT');
    expect(searchUrl.searchParams.get('maxResults')).toBe('2');
    expect(searchUrl.searchParams.get('q')).toBe(
      `rfc822msgid:daily6-${deliveryKey}@lead-finder.invalid`,
    );
  });

  it('returns NOT_FOUND without exposing Gmail response data', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));
    await expect(manualConsumer(fetchMock).searchSent({ deliveryKey: 'b'.repeat(64) }))
      .resolves.toEqual({ state: 'NOT_FOUND' });
  });

  it('accepts Gmail’s empty result form only with resultSizeEstimate zero', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ resultSizeEstimate: 0 }));
    await expect(manualConsumer(fetchMock).searchSent({ deliveryKey: '7'.repeat(64) }))
      .resolves.toEqual({ state: 'NOT_FOUND' });
    const inconsistentFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [], resultSizeEstimate: 1 }));
    await expect(manualConsumer(inconsistentFetch).searchSent({ deliveryKey: '8'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
    const inconsistentFoundFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'one' }], resultSizeEstimate: 2 }));
    await expect(manualConsumer(inconsistentFoundFetch).searchSent({ deliveryKey: '9'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
    const pagedFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'one' }], nextPageToken: 'next-page' }));
    await expect(manualConsumer(pagedFetch).searchSent({ deliveryKey: 'a'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
  });

  it('fails closed as UNKNOWN when Gmail SENT contains duplicate markers', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'one' }, { id: 'two' }] }));
    await expect(manualConsumer(fetchMock).searchSent({ deliveryKey: 'e'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
  });

  it('fails closed as UNKNOWN for an unavailable or malformed search', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    await expect(manualConsumer(fetchMock).searchSent({ deliveryKey: 'c'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
    const missingMessagesFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({}));
    await expect(manualConsumer(missingMessagesFetch).searchSent({ deliveryKey: 'f'.repeat(64) }))
      .resolves.toEqual({ state: 'UNKNOWN' });
    const invalidKeyFetch = vi.fn<OperatorEmailFetch>();
    await expect(manualConsumer(invalidKeyFetch).searchSent({ deliveryKey: 'not-a-key' }))
      .resolves.toEqual({ state: 'UNKNOWN' });
    expect(invalidKeyFetch).not.toHaveBeenCalled();
  });

  it('binds exactly one recipient and emits no CC, BCC or attachment headers', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'synthetic-manual-message-id' }));
    const consumer = manualConsumer(fetchMock);
    await consumer.sendManual(manualMessage);
    const body = fetchMock.mock.calls[1]?.[1]?.body;
    const request = JSON.parse(typeof body === 'string' ? body : '{}') as { raw: string };
    const mimeMessage = Buffer.from(request.raw, 'base64url').toString('utf8');
    expect(mimeMessage).toContain('From: operator@example.test');
    expect(mimeMessage).toContain('To: lead@example.test');
    expect(mimeMessage).toContain('X-Lead-Finder-Purpose: MANUAL_PILOT');
    expect(mimeMessage).not.toContain('Message-ID: <daily6-');
    expect(mimeMessage).not.toMatch(/\r\nCc:/i);
    expect(mimeMessage).not.toMatch(/\r\nBcc:/i);
    expect(mimeMessage).not.toMatch(/Content-Disposition:\s*attachment/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('adds the opaque delivery key to the MIME Message-ID without PII', async () => {
    const deliveryKey = 'd'.repeat(64);
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'synthetic-manual-message-id' }));
    await manualConsumer(fetchMock).sendManual({ ...manualMessage, deliveryKey });
    const body = fetchMock.mock.calls[1]?.[1]?.body;
    const request = JSON.parse(typeof body === 'string' ? body : '{}') as { raw: string };
    const mimeMessage = Buffer.from(request.raw, 'base64url').toString('utf8');
    expect(mimeMessage).toContain(`Message-ID: <daily6-${deliveryKey}@lead-finder.invalid>`);
  });

  it('rejects invalid recipients before network access', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>();
    const consumer = manualConsumer(fetchMock);
    await expect(consumer.sendManual({
      ...manualMessage,
      recipient: 'not-an-email',
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies OAuth failure as deterministic before the Gmail send endpoint', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_FAILED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies an explicit Gmail rejection as deterministic', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'DELIVERY_REJECTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a network interruption during Gmail send as ambiguous', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockRejectedValueOnce(new Error('connection interrupted'));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies Gmail rate limiting without changing the fail-closed state', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({
        code: 'DELIVERY_AMBIGUOUS',
        outcome: 'RATE_LIMITED',
        reason: 'HTTP_429',
      });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 502, 503, 504])(
    'classifies Gmail HTTP %s after POST as ambiguous',
    async (status) => {
      const fetchMock = vi.fn<OperatorEmailFetch>()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
        .mockResolvedValueOnce(jsonResponse({ error: 'server failure' }, status));
      await expect(manualConsumer(fetchMock).sendManual(manualMessage))
        .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('does not treat a non-definitive redirect as a rejection', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a send timeout as ambiguous', async () => {
    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockRejectedValueOnce(timeout);
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('classifies a send timeout as TIMEOUT telemetry', async () => {
    const timeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockRejectedValueOnce(timeout);
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({
        code: 'DELIVERY_AMBIGUOUS',
        outcome: 'TIMEOUT',
        reason: 'TIMEOUT',
      });
  });

  it('classifies OAuth failure as UNAVAILABLE telemetry', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({
        code: 'TOKEN_EXCHANGE_FAILED',
        outcome: 'UNAVAILABLE',
        reason: 'OAUTH_UNAVAILABLE',
      });
  });

  it('returns PROVIDER_SUCCESS telemetry only when Gmail returns an id', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'synthetic-manual-message-id' }));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .resolves.toMatchObject({ outcome: 'PROVIDER_SUCCESS' });
  });

  it('classifies a successful status without a provider id as ambiguous', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 200));
    await expect(manualConsumer(fetchMock).sendManual(manualMessage))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('performs a read-only SENT preflight without a send call or message data', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'sensitive-message-id' }] }));

    await expect(manualConsumer(fetchMock).preflightSent()).resolves.toEqual({
      gmailAuth: 'PASS',
      sentSearch: 'PASS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const searchCall = fetchMock.mock.calls[1];
    const searchInput = searchCall?.[0];
    const searchUrl = searchInput instanceof URL
      ? searchInput
      : new URL(typeof searchInput === 'string' ? searchInput : searchInput?.url ?? '');
    expect(searchCall?.[1]).toMatchObject({
      method: 'GET',
      headers: { authorization: 'Bearer synthetic-access-token' },
    });
    expect(searchUrl.searchParams.get('q')).toBe('in:sent');
    expect(searchUrl.searchParams.get('labelIds')).toBe('SENT');
    expect(searchUrl.searchParams.get('maxResults')).toBe('1');
    expect(searchUrl.searchParams.get('q')).not.toContain('sensitive-message-id');
    const requestUrls = fetchMock.mock.calls.map(([input]) => input instanceof URL
      ? input.toString()
      : typeof input === 'string' ? input : input.url);
    expect(requestUrls.some((url) => url.includes('/send'))).toBe(false);
  });

  it('fails closed when Gmail OAuth preflight is rejected', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));

    await expect(manualConsumer(fetchMock).preflightSent()).resolves.toEqual({
      gmailAuth: 'FAIL',
      sentSearch: 'NOT_PROVEN',
      errorClass: 'AUTH_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the read-only SENT search is unavailable or malformed', async () => {
    const unavailableFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));
    await expect(manualConsumer(unavailableFetch).preflightSent()).resolves.toEqual({
      gmailAuth: 'PASS',
      sentSearch: 'NOT_PROVEN',
      errorClass: 'AUTH_INVALID',
    });

    const malformedFetch = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    await expect(manualConsumer(malformedFetch).preflightSent()).resolves.toEqual({
      gmailAuth: 'PASS',
      sentSearch: 'NOT_PROVEN',
      errorClass: 'GOOGLE_API_ERROR',
    });
  });
});
