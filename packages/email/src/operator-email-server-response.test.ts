import { describe, expect, it, vi } from 'vitest';
import {
  createGmailApiOperatorEmailConsumer,
  type OperatorEmailFetch,
} from './index.js';

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

const configuration = {
  sender: 'operator@example.test',
  recipient: 'operator@example.test',
  googleClientId: '123456789-synthetic.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-synthetic-client-secret',
  googleRefreshToken: '1//synthetic-refresh-token-value',
};

const message = {
  subject: 'Teste interno',
  body: 'Nenhum lead real está envolvido.',
} as const;

const consumerForStatus = (status: number) => {
  const fetchMock = vi.fn<OperatorEmailFetch>()
    .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
    .mockResolvedValueOnce(jsonResponse({ error: 'synthetic' }, status));
  return {
    consumer: createGmailApiOperatorEmailConsumer(configuration, fetchMock),
    fetchMock,
  };
};

describe('Gmail operator self-test response classification', () => {
  it('treats Gmail 5xx as ambiguous because acceptance is not disproved', async () => {
    const { consumer, fetchMock } = consumerForStatus(503);
    await expect(consumer.sendInternalTest(message))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an explicit Gmail authorization rejection deterministic', async () => {
    const { consumer, fetchMock } = consumerForStatus(403);
    await expect(consumer.sendInternalTest(message))
      .rejects.toMatchObject({ code: 'DELIVERY_REJECTED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network interruption after the Gmail POST as ambiguous', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockRejectedValueOnce(new Error('synthetic connection interruption'));
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);
    await expect(consumer.sendInternalTest(message))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a successful response without a Gmail message id as ambiguous', async () => {
    const fetchMock = vi.fn<OperatorEmailFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'synthetic-access-token' }))
      .mockResolvedValueOnce(jsonResponse({}, 200));
    const consumer = createGmailApiOperatorEmailConsumer(configuration, fetchMock);
    await expect(consumer.sendInternalTest(message))
      .rejects.toMatchObject({ code: 'DELIVERY_AMBIGUOUS' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
