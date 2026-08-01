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
  it('binds the recipient per approved preparation and marks the MIME purpose', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'synthetic-manual-message-id' }));
    const consumer = createGmailApiManualEmailConsumer({ sender: configuration.sender, googleClientId: configuration.googleClientId, googleClientSecret: configuration.googleClientSecret, googleRefreshToken: configuration.googleRefreshToken }, fetchMock);
    await consumer.sendManual({ subject: 'Ideia para Empresa', body: 'Mensagem individual.', recipient: 'lead@example.test' });
    const body = fetchMock.mock.calls[1]?.[1]?.body;
    const request = JSON.parse(typeof body === 'string' ? body : '{}') as { raw: string };
    const mimeMessage = Buffer.from(request.raw, 'base64url').toString('utf8');
    expect(mimeMessage).toContain('From: operator@example.test');
    expect(mimeMessage).toContain('To: lead@example.test');
    expect(mimeMessage).toContain('X-Lead-Finder-Purpose: MANUAL_PILOT');
  });

  it('rejects invalid recipients before network access', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>();
    const consumer = createGmailApiManualEmailConsumer({ sender: configuration.sender, googleClientId: configuration.googleClientId, googleClientSecret: configuration.googleClientSecret, googleRefreshToken: configuration.googleRefreshToken }, fetchMock);
    await expect(consumer.sendManual({ subject: 'Teste', body: 'Teste', recipient: 'not-an-email' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
