import { z } from 'zod';

const normalizedEmail = z.string().trim().toLowerCase().email().max(320);
const printableSecret = (name: string, maximum: number) => z
  .string()
  .min(16)
  .max(maximum)
  .regex(/^[\x21-\x7e]+$/, `${name} must contain printable non-space ASCII characters only`);
const operatorEmailConfigurationSchema = z
  .object({
    sender: normalizedEmail,
    recipient: normalizedEmail,
    googleClientId: z
      .string()
      .trim()
      .min(16)
      .max(512)
      .regex(
        /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/,
        'Google OAuth client ID is invalid',
      ),
    googleClientSecret: printableSecret('Google OAuth client secret', 512),
    googleRefreshToken: printableSecret('Google OAuth refresh token', 1_024),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sender !== value.recipient) {
      context.addIssue({
        code: 'custom',
        path: ['recipient'],
        message: 'operator email sender and recipient must be identical',
      });
    }
    if (value.googleClientSecret === value.googleRefreshToken) {
      context.addIssue({
        code: 'custom',
        path: ['googleRefreshToken'],
        message: 'Google OAuth client secret and refresh token must differ',
      });
    }
  });

const subjectSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\r\n]/.test(value), 'subject must not contain line breaks');
const bodySchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => !value.includes('\u0000'), 'body must not contain null bytes');
const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(4_096),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});
const gmailSendResponseSchema = z.object({
  id: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512).optional(),
});

export type OperatorEmailMessage = Readonly<{
  subject: string;
  body: string;
}>;

export type OperatorEmailDeliveryReceipt = Readonly<{
  provider: 'GMAIL_API';
  messageId: string;
  response: string;
}>;
export type ManualEmailMessage = Readonly<{ subject: string; body: string; recipient: string }>;

export type OperatorEmailFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const defaultFetch: OperatorEmailFetch = (input, init) => fetch(input, init);

export class OperatorEmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_CONFIGURATION'
      | 'TOKEN_EXCHANGE_FAILED'
      | 'DELIVERY_REJECTED',
  ) {
    super(message);
  }
}

const encodeHeader = (value: string) =>
  `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const wrapBase64 = (value: string) => value.match(/.{1,76}/g)?.join('\r\n') ?? '';

const createRawMessage = (
  configuration: Readonly<{ sender: string; recipient?: string }>,
  message: OperatorEmailMessage | ManualEmailMessage,
  purpose: 'OPERATOR_TEST' | 'MANUAL_PILOT',
) => {
  const subject = subjectSchema.parse(message.subject);
  const body = bodySchema.parse(message.body);
  const encodedBody = wrapBase64(Buffer.from(body, 'utf8').toString('base64'));
  const mimeMessage = [
    `From: ${configuration.sender}`,
    `To: ${'recipient' in message ? message.recipient : configuration.recipient!}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    `X-Lead-Finder-Purpose: ${purpose}`,
    '',
    encodedBody,
  ].join('\r\n');
  return Buffer.from(mimeMessage, 'utf8').toString('base64url');
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

export function createGmailApiOperatorEmailConsumer(
  input: {
    sender: string;
    recipient: string;
    googleClientId: string;
    googleClientSecret: string;
    googleRefreshToken: string;
  },
  fetchImpl: OperatorEmailFetch = defaultFetch,
) {
  const parsed = operatorEmailConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperatorEmailDeliveryError(
      'Operator email configuration is invalid',
      'INVALID_CONFIGURATION',
    );
  }
  const configuration = parsed.data;

  return {
    async sendInternalTest(message: OperatorEmailMessage): Promise<OperatorEmailDeliveryReceipt> {
      const raw = createRawMessage(configuration, message, 'OPERATOR_TEST');
      const tokenBody = new URLSearchParams({
        client_id: configuration.googleClientId,
        client_secret: configuration.googleClientSecret,
        refresh_token: configuration.googleRefreshToken,
        grant_type: 'refresh_token',
      });

      let tokenResponse: Response;
      try {
        tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: tokenBody,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new OperatorEmailDeliveryError(
          'Google OAuth token exchange failed',
          'TOKEN_EXCHANGE_FAILED',
        );
      }
      const token = tokenResponse.ok
        ? tokenResponseSchema.safeParse(await parseJson(tokenResponse))
        : undefined;
      if (!token?.success) {
        throw new OperatorEmailDeliveryError(
          'Google OAuth token exchange failed',
          'TOKEN_EXCHANGE_FAILED',
        );
      }

      let deliveryResponse: Response;
      try {
        deliveryResponse = await fetchImpl(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token.data.access_token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ raw }),
            signal: AbortSignal.timeout(15_000),
          },
        );
      } catch {
        throw new OperatorEmailDeliveryError(
          'Operator email delivery was rejected',
          'DELIVERY_REJECTED',
        );
      }
      const delivery = deliveryResponse.ok
        ? gmailSendResponseSchema.safeParse(await parseJson(deliveryResponse))
        : undefined;
      if (!delivery?.success) {
        throw new OperatorEmailDeliveryError(
          'Operator email delivery was rejected',
          'DELIVERY_REJECTED',
        );
      }
      return {
        provider: 'GMAIL_API',
        messageId: delivery.data.id,
        response: `HTTP ${deliveryResponse.status}`,
      };
    },
  } as const;
}

export function createGmailApiManualEmailConsumer(
  input: {
    sender: string;
    googleClientId: string;
    googleClientSecret: string;
    googleRefreshToken: string;
  },
  fetchImpl: OperatorEmailFetch = defaultFetch,
) {
  const parsed = z.object({
    sender: normalizedEmail,
    googleClientId: z.string().trim().min(16).max(512),
    googleClientSecret: printableSecret('Google OAuth client secret', 512),
    googleRefreshToken: printableSecret('Google OAuth refresh token', 1_024),
  }).strict().safeParse(input);
  if (!parsed.success) throw new OperatorEmailDeliveryError('Manual email configuration is invalid', 'INVALID_CONFIGURATION');
  const configuration = parsed.data;
  return {
    async sendManual(message: ManualEmailMessage): Promise<OperatorEmailDeliveryReceipt> {
      const recipient = normalizedEmail.parse(message.recipient);
      const raw = createRawMessage(configuration, { ...message, recipient }, 'MANUAL_PILOT');
      const tokenBody = new URLSearchParams({ client_id: configuration.googleClientId, client_secret: configuration.googleClientSecret, refresh_token: configuration.googleRefreshToken, grant_type: 'refresh_token' });
      let tokenResponse: Response;
      try { tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody, signal: AbortSignal.timeout(10_000) }); }
      catch { throw new OperatorEmailDeliveryError('Google OAuth token exchange failed', 'TOKEN_EXCHANGE_FAILED'); }
      const token = tokenResponse.ok ? tokenResponseSchema.safeParse(await parseJson(tokenResponse)) : undefined;
      if (!token?.success) throw new OperatorEmailDeliveryError('Google OAuth token exchange failed', 'TOKEN_EXCHANGE_FAILED');
      let deliveryResponse: Response;
      try { deliveryResponse = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: `Bearer ${token.data.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(15_000) }); }
      catch { throw new OperatorEmailDeliveryError('Manual email delivery was rejected', 'DELIVERY_REJECTED'); }
      const delivery = deliveryResponse.ok ? gmailSendResponseSchema.safeParse(await parseJson(deliveryResponse)) : undefined;
      if (!delivery?.success) throw new OperatorEmailDeliveryError('Manual email delivery was rejected', 'DELIVERY_REJECTED');
      return { provider: 'GMAIL_API', messageId: delivery.data.id, response: `HTTP ${deliveryResponse.status}` };
    },
  } as const;
}
