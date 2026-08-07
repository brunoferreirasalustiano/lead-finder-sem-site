import { describe, expect, it, vi } from 'vitest';
import {
  createGmailApiManualEmailConsumer,
  type OperatorEmailFetch,
} from './index.js';

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

const configuration = {
  sender: 'operator@example.test',
  googleClientId: '123456789-synthetic.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-synthetic-client-secret',
  googleRefreshToken: '1//synthetic-refresh-token-value',
};

const message = {
  subject: 'Ideia para Empresa',
  body: 'Mensagem individual.',
  recipient: 'lead@example.test',
} as const;

const consumerForStatus = (status: number) => {
  const fetchMock = vi.fn<OperatorEmailFetch>()
    .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
    .mockResolvedValueOnce(jsonResponse({ error: 'synthetic' }, status));
  return { consumer: createGmailApiManualEmailConsumer(configuration, fetchMock), fetchMock };
};

describe('Gmail manual send response classification', () => {
  it('treats Gmail 5xx responses as ambiguous because acceptance is not disproved', async () => {
    const { consumer, fetchMock } = consumerForStatus(503);
    await expect(consumer.sendManual(message))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an explicit authorization rejection deterministic', async () => {
    const { consumer, fetchMock } = consumerForStatus(403);
    await expect(consumer.sendManual(message))
      .rejects.toMatchObject({ code: 'DELIVERY_REJECTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
