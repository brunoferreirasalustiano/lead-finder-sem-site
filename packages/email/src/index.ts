import nodemailer from 'nodemailer';
import { z } from 'zod';

const normalizedEmail = z.string().trim().toLowerCase().email().max(320);
const operatorEmailConfigurationSchema = z
  .object({
    sender: normalizedEmail,
    recipient: normalizedEmail,
    smtpUser: normalizedEmail,
    smtpAppPassword: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9]+$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sender !== value.recipient || value.sender !== value.smtpUser) {
      context.addIssue({
        code: 'custom',
        path: ['recipient'],
        message: 'operator email sender, recipient, and SMTP user must be identical',
      });
    }
  });

export type OperatorEmailMessage = Readonly<{
  subject: string;
  body: string;
}>;

export type OperatorEmailDeliveryReceipt = Readonly<{
  provider: 'GMAIL_SMTP';
  messageId: string;
  response: string;
}>;

type MailResult = Readonly<{
  accepted?: readonly unknown[];
  rejected?: readonly unknown[];
  messageId?: unknown;
  response?: unknown;
}>;

export type OperatorEmailTransport = Readonly<{
  verify: () => Promise<unknown>;
  sendMail: (input: Readonly<Record<string, unknown>>) => Promise<MailResult>;
}>;

type TransportFactory = (configuration: Readonly<Record<string, unknown>>) => OperatorEmailTransport;

const defaultTransportFactory: TransportFactory = (configuration) =>
  nodemailer.createTransport(configuration);

export class OperatorEmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_CONFIGURATION' | 'DELIVERY_REJECTED',
  ) {
    super(message);
  }
}

export function createGmailOperatorEmailConsumer(
  input: {
    sender: string;
    recipient: string;
    smtpUser: string;
    smtpAppPassword: string;
  },
  transportFactory: TransportFactory = defaultTransportFactory,
) {
  const parsed = operatorEmailConfigurationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OperatorEmailDeliveryError(
      'Operator email configuration is invalid',
      'INVALID_CONFIGURATION',
    );
  }
  const configuration = parsed.data;
  const transport = transportFactory({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: configuration.smtpUser,
      pass: configuration.smtpAppPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendInternalTest(message: OperatorEmailMessage): Promise<OperatorEmailDeliveryReceipt> {
      const subject = z.string().trim().min(1).max(200).parse(message.subject);
      const body = z.string().trim().min(1).max(2_000).parse(message.body);
      await transport.verify();
      const result = await transport.sendMail({
        from: configuration.sender,
        to: configuration.recipient,
        subject,
        text: body,
        headers: {
          'X-Lead-Finder-Purpose': 'OPERATOR_TEST',
        },
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        result.accepted?.length !== 1
        || (result.rejected?.length ?? 0) !== 0
        || typeof result.messageId !== 'string'
        || typeof result.response !== 'string'
      ) {
        throw new OperatorEmailDeliveryError(
          'Operator email delivery was rejected',
          'DELIVERY_REJECTED',
        );
      }
      return {
        provider: 'GMAIL_SMTP',
        messageId: result.messageId,
        response: result.response,
      };
    },
  } as const;
}
